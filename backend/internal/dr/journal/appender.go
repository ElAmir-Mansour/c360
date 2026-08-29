package journal

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

// Event types emitted to the DR events topic as the journal evolves.
const (
	// EventTypeSegmentSealed announces a new journal segment (more APIT coverage).
	EventTypeSegmentSealed = "dr.journal.segment.sealed"
	// EventTypeBookmarkCreated announces a new restore point.
	EventTypeBookmarkCreated = "dr.journal.bookmark.created"
	// EventTypeSegmentPruned announces a reclaimed segment (coverage shrank).
	EventTypeSegmentPruned = "dr.journal.segment.pruned"

	eventSource = "clario-dr-service/journal"

	// drEventsTopic is the lifecycle topic. The integration phase already defines
	// events.Topics.DREvents = "datastream.dr.events"; using the literal keeps
	// this package from editing the shared topics file.
	drEventsTopic = "datastream.dr.events"
)

// Default rolling thresholds. A segment is sealed when it reaches MaxFrames OR
// MaxBytes OR MaxAge since the segment opened — whichever trips first — so a
// busy stream rolls by size and a quiet stream still rolls by time, bounding the
// "tail" of un-journaled frames (the recovery floor).
const (
	defaultMaxFrames = 1024
	defaultMaxBytes  = 16 * 1024 * 1024 // 16 MiB
	defaultMaxAge    = 30 * time.Second
)

// SegmentSink durably stores the sealed bytes of a journal segment and returns
// the object key referencing them. The integration phase supplies an
// implementation backed by the same durable store as the applied frames
// (internal/dr/framestore / WORM), so a segment's object_key points at the exact
// sealed range. Defining it as a seam keeps this package from importing the
// object store and lets the appender be unit-tested with an in-memory sink.
type SegmentSink interface {
	// SealSegment writes the contiguous payload bytes for [minSeq,maxSeq] of a
	// stream and returns the durable object key. It must be idempotent on
	// (tenantID, streamID, minSeq): a replayed seal returns the same key.
	SealSegment(ctx context.Context, tenantID uuid.UUID, streamID string, minSeq, maxSeq int64, payload []byte) (objectKey string, err error)
}

// TenantRunner runs a function inside a tenant-scoped read-write transaction
// (RLS set). *pgxpool.Pool is adapted by PGXRunner; tests supply a fake.
type TenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// PGXRunner adapts a pgx pool to TenantRunner using the shared tenant-context
// helpers (SET LOCAL app.current_tenant_id so RLS applies).
type PGXRunner struct {
	Pool *pgxpool.Pool
}

// RunWithTenant runs fn in a tenant-scoped read-write transaction.
func (r PGXRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return errors.New("journal: nil transaction pool")
	}
	return database.RunWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunReadWithTenant runs fn in a tenant-scoped read transaction.
func (r PGXRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return errors.New("journal: nil transaction pool")
	}
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// segmentStore is the persistence surface the appender uses.
type segmentStore interface {
	AppendSegment(ctx context.Context, db repository.DBTX, s *Segment) error
	LatestSealedSeq(ctx context.Context, db repository.DBTX, tenantID, streamID string) (int64, error)
}

// AppenderConfig wires an Appender.
type AppenderConfig struct {
	Runner    TenantRunner
	Store     segmentStore
	Sink      SegmentSink
	Metrics   *Metrics
	Logger    zerolog.Logger
	MaxFrames int
	MaxBytes  int64
	MaxAge    time.Duration
	Now       func() time.Time
}

// Appender folds the change frames of a stream into time-/size-bounded journal
// segments as they are applied. It buffers frames per stream and, when a roll
// threshold trips (frame count, byte size, or age), seals the buffered bytes via
// the SegmentSink and records the index row + a lifecycle event in one tenant
// transaction — so an APIT resolve can later replay this exact range.
//
// It is safe for concurrent use across streams; per-stream buffers are guarded
// by a single mutex (the critical section is short — a slice append).
type Appender struct {
	runner    TenantRunner
	store     segmentStore
	sink      SegmentSink
	metrics   *Metrics
	logger    zerolog.Logger
	maxFrames int
	maxBytes  int64
	maxAge    time.Duration
	now       func() time.Time

	mu      sync.Mutex
	buffers map[string]*streamBuffer // keyed by tenantID|streamID
}

// streamBuffer accumulates a contiguous run of frames for one stream until it is
// sealed into a segment.
type streamBuffer struct {
	tenantID  uuid.UUID
	streamID  string
	frames    []core.Frame
	bytes     int64
	openedAt  time.Time // wall clock the buffer first received a frame
	minSeq    int64
	maxSeq    int64
	minLSN    string
	maxLSN    string
	minTS     time.Time
	maxTS     time.Time
	expectSeq int64 // next contiguous Seq expected (0 = empty)
}

// NewAppender constructs an Appender. Runner, Store and Sink are required.
func NewAppender(cfg AppenderConfig) (*Appender, error) {
	if cfg.Runner == nil {
		return nil, errors.New("journal appender: tenant runner is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("journal appender: segment store is required")
	}
	if cfg.Sink == nil {
		return nil, errors.New("journal appender: segment sink is required")
	}
	if cfg.MaxFrames <= 0 {
		cfg.MaxFrames = defaultMaxFrames
	}
	if cfg.MaxBytes <= 0 {
		cfg.MaxBytes = defaultMaxBytes
	}
	if cfg.MaxAge <= 0 {
		cfg.MaxAge = defaultMaxAge
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Appender{
		runner:    cfg.Runner,
		store:     cfg.Store,
		sink:      cfg.Sink,
		metrics:   cfg.Metrics,
		logger:    cfg.Logger.With().Str("component", "dr-journal-appender").Logger(),
		maxFrames: cfg.MaxFrames,
		maxBytes:  cfg.MaxBytes,
		maxAge:    cfg.MaxAge,
		now:       now,
		buffers:   make(map[string]*streamBuffer),
	}, nil
}

func bufferKey(tenantID uuid.UUID, streamID string) string {
	return tenantID.String() + "|" + streamID
}

// Append folds one applied frame into the stream's open segment buffer. When the
// buffer trips a roll threshold the segment is sealed (durable bytes + index row
// + event) before Append returns. Frames must be supplied in contiguous Seq
// order per stream — the appender runs behind the pipeline's ordered, idempotent
// apply (DESIGN §3.2), so duplicates (Seq <= the last buffered/sealed) are
// idempotent no-ops and a gap is an error (the buffer must stay contiguous to be
// resolvable). A MARKER frame additionally forces an immediate seal so an
// app-consistent barrier always lands on a segment boundary.
func (a *Appender) Append(ctx context.Context, tenantID uuid.UUID, f core.Frame) error {
	if tenantID == uuid.Nil {
		return fmt.Errorf("%w: tenant id is required", ErrInvalid)
	}
	if f.StreamID == "" {
		return fmt.Errorf("%w: frame stream id is required", ErrInvalid)
	}
	if f.Seq == 0 {
		return fmt.Errorf("%w: frame seq must be positive", ErrInvalid)
	}
	if !f.Kind.Valid() {
		return fmt.Errorf("%w: frame kind %d is invalid", ErrInvalid, f.Kind)
	}

	a.mu.Lock()
	key := bufferKey(tenantID, f.StreamID)
	buf := a.buffers[key]
	if buf == nil {
		// New buffer: open it at the next Seq after whatever is already sealed.
		sealed, err := a.latestSealed(ctx, tenantID, f.StreamID)
		if err != nil {
			a.mu.Unlock()
			return err
		}
		buf = &streamBuffer{tenantID: tenantID, streamID: f.StreamID, expectSeq: sealed + 1}
		a.buffers[key] = buf
	}

	seq := int64(f.Seq)
	// Idempotent: a frame at or before the next expected Seq was already folded
	// (sealed or buffered) — a safe no-op after a resume/re-delivery.
	if seq < buf.expectSeq {
		a.mu.Unlock()
		return nil
	}
	if seq > buf.expectSeq {
		a.mu.Unlock()
		return fmt.Errorf("%w: stream %s frame seq %d skips expected %d (non-contiguous)",
			ErrInvalid, f.StreamID, seq, buf.expectSeq)
	}

	a.foldLocked(buf, f, seq)

	forceSeal := f.Kind == core.FrameKindMarker
	shouldSeal := forceSeal || a.shouldSealLocked(buf)
	if !shouldSeal {
		a.mu.Unlock()
		return nil
	}
	// Detach the buffer under the lock so concurrent Appends for the stream open
	// a fresh one; seal outside the lock (sink I/O + DB tx must not block peers).
	delete(a.buffers, key)
	a.mu.Unlock()

	return a.seal(ctx, buf)
}

// foldLocked appends f to buf and updates the running bounds. Caller holds mu.
func (a *Appender) foldLocked(buf *streamBuffer, f core.Frame, seq int64) {
	emitted := f.EmittedAt
	if emitted.IsZero() {
		emitted = a.now()
	}
	if len(buf.frames) == 0 {
		buf.openedAt = a.now()
		buf.minSeq = seq
		buf.minTS = emitted
		buf.maxTS = emitted
		buf.minLSN = f.SourceLSN
		buf.maxLSN = f.SourceLSN
	}
	buf.frames = append(buf.frames, f)
	buf.bytes += int64(len(f.Payload))
	buf.maxSeq = seq
	if emitted.Before(buf.minTS) {
		buf.minTS = emitted
	}
	if emitted.After(buf.maxTS) {
		buf.maxTS = emitted
	}
	if f.SourceLSN != "" {
		if buf.minLSN == "" || CompareLSN(f.SourceLSN, buf.minLSN) < 0 {
			buf.minLSN = f.SourceLSN
		}
		if CompareLSN(f.SourceLSN, buf.maxLSN) > 0 {
			buf.maxLSN = f.SourceLSN
		}
	}
	buf.expectSeq = seq + 1
}

// shouldSealLocked reports whether buf has tripped a roll threshold. Caller holds mu.
func (a *Appender) shouldSealLocked(buf *streamBuffer) bool {
	if len(buf.frames) >= a.maxFrames {
		return true
	}
	if buf.bytes >= a.maxBytes {
		return true
	}
	if !buf.openedAt.IsZero() && a.now().Sub(buf.openedAt) >= a.maxAge {
		return true
	}
	return false
}

// Flush seals any open buffer for a stream immediately (e.g. on a checkpoint
// barrier, pause, or shutdown) so its frames become recoverable without waiting
// for a roll threshold. A stream with no buffered frames is a no-op.
func (a *Appender) Flush(ctx context.Context, tenantID uuid.UUID, streamID string) error {
	a.mu.Lock()
	key := bufferKey(tenantID, streamID)
	buf := a.buffers[key]
	if buf == nil || len(buf.frames) == 0 {
		a.mu.Unlock()
		return nil
	}
	delete(a.buffers, key)
	a.mu.Unlock()
	return a.seal(ctx, buf)
}

// FlushAll seals every open buffer (graceful shutdown).
func (a *Appender) FlushAll(ctx context.Context) error {
	a.mu.Lock()
	pending := make([]*streamBuffer, 0, len(a.buffers))
	for key, buf := range a.buffers {
		if len(buf.frames) > 0 {
			pending = append(pending, buf)
		}
		delete(a.buffers, key)
	}
	a.mu.Unlock()

	var firstErr error
	for _, buf := range pending {
		if err := a.seal(ctx, buf); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// seal writes the buffered frames' bytes to the sink and records the segment
// index row + lifecycle event in one tenant transaction. The wire bytes are the
// canonical length-prefixed frame encoding (core.EncodeFrame), so the sealed
// object is replayable by the recovery executor with core.DecodeFrames.
func (a *Appender) seal(ctx context.Context, buf *streamBuffer) error {
	if len(buf.frames) == 0 {
		return nil
	}
	payload, hash, err := encodeSegment(buf.frames)
	if err != nil {
		return fmt.Errorf("encoding journal segment stream=%s [%d,%d]: %w", buf.streamID, buf.minSeq, buf.maxSeq, err)
	}

	objectKey, err := a.sink.SealSegment(ctx, buf.tenantID, buf.streamID, buf.minSeq, buf.maxSeq, payload)
	if err != nil {
		return fmt.Errorf("sealing journal segment bytes stream=%s [%d,%d]: %w", buf.streamID, buf.minSeq, buf.maxSeq, err)
	}

	seg := &Segment{
		TenantID:     buf.tenantID.String(),
		StreamID:     buf.streamID,
		MinSeq:       buf.minSeq,
		MaxSeq:       buf.maxSeq,
		FrameCount:   len(buf.frames),
		MinLSN:       buf.minLSN,
		MaxLSN:       buf.maxLSN,
		MinTS:        buf.minTS,
		MaxTS:        buf.maxTS,
		ObjectKey:    objectKey,
		PayloadBytes: int64(len(payload)),
		ContentHash:  hash,
	}

	err = a.runner.RunWithTenant(ctx, buf.tenantID, func(tx repository.DBTX) error {
		if err := a.store.AppendSegment(ctx, tx, seg); err != nil {
			// A replayed seal of an already-recorded range is an idempotent no-op:
			// the bytes are durable and the index row exists.
			if errors.Is(err, ErrAlreadyExists) {
				return nil
			}
			return err
		}
		evt, err := events.NewEvent(EventTypeSegmentSealed, eventSource, buf.tenantID.String(), map[string]any{
			"stream_id":     seg.StreamID,
			"segment_id":    seg.ID,
			"min_seq":       seg.MinSeq,
			"max_seq":       seg.MaxSeq,
			"frame_count":   seg.FrameCount,
			"min_ts":        seg.MinTS,
			"max_ts":        seg.MaxTS,
			"payload_bytes": seg.PayloadBytes,
			"object_key":    seg.ObjectKey,
		})
		if err != nil {
			return fmt.Errorf("building segment-sealed event: %w", err)
		}
		return outbox.Write(ctx, tx, drEventsTopic, evt)
	})
	if err != nil {
		return fmt.Errorf("recording journal segment stream=%s [%d,%d]: %w", buf.streamID, buf.minSeq, buf.maxSeq, err)
	}

	a.metrics.IncSegmentSealed(buf.streamID, len(buf.frames))
	a.logger.Debug().
		Str("tenant_id", buf.tenantID.String()).
		Str("stream_id", buf.streamID).
		Int64("min_seq", buf.minSeq).
		Int64("max_seq", buf.maxSeq).
		Int("frames", len(buf.frames)).
		Str("object_key", objectKey).
		Msg("journal segment sealed")
	return nil
}

// latestSealed reads the highest sealed Seq for a stream in a read tx so a fresh
// buffer opens contiguously after a restart. Caller holds mu.
func (a *Appender) latestSealed(ctx context.Context, tenantID uuid.UUID, streamID string) (int64, error) {
	var sealed int64
	err := a.runner.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		sealed, err = a.store.LatestSealedSeq(ctx, tx, tenantID.String(), streamID)
		return err
	})
	if err != nil {
		return 0, fmt.Errorf("loading latest sealed seq stream=%s: %w", streamID, err)
	}
	return sealed, nil
}

// encodeSegment serializes a contiguous frame run into the canonical wire format
// and returns the bytes and their sha256 hex content hash (tamper evidence).
func encodeSegment(frames []core.Frame) ([]byte, string, error) {
	var buf segmentEncoder
	for _, f := range frames {
		if err := core.EncodeFrame(&buf, f); err != nil {
			return nil, "", err
		}
	}
	sum := sha256.Sum256(buf.b)
	return buf.b, hex.EncodeToString(sum[:]), nil
}

// segmentEncoder is a tiny io.Writer accumulator (avoids bytes.Buffer's extra
// allocation churn for the common small-segment case).
type segmentEncoder struct{ b []byte }

func (e *segmentEncoder) Write(p []byte) (int, error) {
	e.b = append(e.b, p...)
	return len(p), nil
}
