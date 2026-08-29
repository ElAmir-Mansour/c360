package core

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Progress is the periodic telemetry the pipeline emits as it ships and applies
// frames. It feeds datastream.dr.progress events and the SLO board (§3.2, §11).
type Progress struct {
	StreamID      string
	AppliedSeq    uint64
	BytesApplied  uint64
	FramesApplied uint64
	Lag           time.Duration
	ThroughputBPS float64
	BufferDepth   int
}

// EmitFunc receives progress samples. A nil EmitFunc disables emission.
type EmitFunc func(Progress)

// PipelineConfig tunes emission cadence. Zero values fall back to defaults.
type PipelineConfig struct {
	EmitEveryFrames  uint64
	EmitInterval     time.Duration
	MaxReorderFrames int
	MaxReorderBytes  uint64
	ShutdownTimeout  time.Duration
}

func (c PipelineConfig) withDefaults() PipelineConfig {
	if c.EmitEveryFrames == 0 {
		c.EmitEveryFrames = 64
	}
	if c.EmitInterval == 0 {
		c.EmitInterval = 5 * time.Second
	}
	if c.MaxReorderFrames <= 0 {
		c.MaxReorderFrames = 8192
	}
	if c.MaxReorderBytes == 0 {
		c.MaxReorderBytes = 512 * 1024 * 1024
	}
	if c.ShutdownTimeout == 0 {
		c.ShutdownTimeout = 5 * time.Second
	}
	return c
}

// ErrNonContiguousStream is returned when the transport closes the frame channel
// while frames remain buffered ahead of a gap. The checkpoint is left at the
// last contiguous Seq so a later run can resume and fill the gap.
var ErrNonContiguousStream = errors.New("core: non-contiguous frame stream")

// ErrReorderBufferFull is returned when ahead-of-gap buffering exceeds the
// configured in-memory safety limit.
var ErrReorderBufferFull = errors.New("core: reorder buffer limit exceeded")

// Pipeline orchestrates the five replication stages for one stream. It owns
// frame ordering and de-duplication: a reorder buffer keyed by Seq, applies
// strictly in contiguous Seq order, de-dupes by (StreamID, Seq), and advances
// the checkpoint only across a contiguous applied range (§3.2).
type Pipeline struct {
	cfg     PipelineConfig
	metrics *Metrics
	now     func() time.Time
}

// NewPipeline builds a Pipeline. A nil metrics is allowed (no metric emission).
func NewPipeline(cfg PipelineConfig, metrics *Metrics) *Pipeline {
	return &Pipeline{cfg: cfg.withDefaults(), metrics: metrics, now: time.Now}
}

// Run wires Capturer -> Transport -> Applier -> Checkpointer for streamID
// (§3.2), applying frames in strict contiguous Seq order through a reorder
// buffer and advancing the checkpoint only across contiguous ranges. It returns
// nil when the frame channel drains with no gap, and a wrapped error otherwise.
func (p *Pipeline) Run(
	ctx context.Context,
	streamID string,
	capturer Capturer,
	tr Transport,
	ap Applier,
	cp Checkpointer,
	emit EmitFunc,
) (err error) {
	if streamID == "" {
		return errors.New("pipeline: streamID is required")
	}
	if capturer == nil || tr == nil || ap == nil || cp == nil {
		return fmt.Errorf("pipeline %s: capturer, transport, applier and checkpointer are required", streamID)
	}
	if !capturer.Kind().Valid() {
		return fmt.Errorf("pipeline %s: capturer kind %d is invalid", streamID, capturer.Kind())
	}
	if !ap.Kind().Valid() {
		return fmt.Errorf("pipeline %s: applier kind %d is invalid", streamID, ap.Kind())
	}

	runCtx, cancel := context.WithCancel(ctx)
	var captureDone <-chan struct{}
	defer func() {
		cancel()
		if closeErr := capturer.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("pipeline %s: close capturer: %w", streamID, closeErr)
		}
		if captureDone != nil {
			select {
			case <-captureDone:
			case <-time.After(p.cfg.ShutdownTimeout):
				if err == nil {
					err = fmt.Errorf("pipeline %s: capturer did not stop within %s", streamID, p.cfg.ShutdownTimeout)
				}
			}
		}
	}()

	checkpoint, err := cp.Load(runCtx, streamID)
	if err != nil {
		return fmt.Errorf("pipeline %s: load checkpoint: %w", streamID, err)
	}
	if checkpoint.StreamID != "" && checkpoint.StreamID != streamID {
		return fmt.Errorf("pipeline %s: loaded checkpoint belongs to stream %s", streamID, checkpoint.StreamID)
	}
	resumeFrom := checkpoint.AppliedSeq

	captured := make(chan Frame, 64)
	captureErr := make(chan error, 1)
	captureDoneCh := make(chan struct{})
	captureDone = captureDoneCh
	go func() {
		defer close(captureDoneCh)
		defer close(captured)
		captureErr <- capturer.Start(runCtx, resumeFrom, captured)
	}()

	frames, ack, receiveErrs, err := tr.Receive(runCtx)
	if err != nil {
		return fmt.Errorf("pipeline %s: transport receive: %w", streamID, err)
	}

	_, sendErrs, err := tr.Send(runCtx, captured)
	if err != nil {
		return fmt.Errorf("pipeline %s: transport send: %w", streamID, err)
	}

	st := &applyState{
		streamID:    streamID,
		appliedSeq:  resumeFrom,
		sourceLSN:   checkpoint.SourceLSN,
		sourceAcker: optionalSourceLSNAcker(capturer),
		reorderBuf:  make(map[uint64]Frame),
		lastEmit:    p.now(),
	}

	ticker := time.NewTicker(p.cfg.EmitInterval)
	defer ticker.Stop()
	emitCh, stopEmit := startProgressEmitter(emit, p.cfg.ShutdownTimeout)
	defer stopEmit()

	for {
		select {
		case <-runCtx.Done():
			return fmt.Errorf("pipeline %s: %w", streamID, runCtx.Err())

		case serr, ok := <-sendErrs:
			if !ok {
				sendErrs = nil
				continue
			}
			if serr != nil {
				return fmt.Errorf("pipeline %s: transport send: %w", streamID, serr)
			}

		case rerr, ok := <-receiveErrs:
			if !ok {
				receiveErrs = nil
				continue
			}
			if rerr != nil {
				return fmt.Errorf("pipeline %s: transport receive: %w", streamID, rerr)
			}

		case cerr := <-captureErr:
			if cerr != nil {
				return fmt.Errorf("pipeline %s: capturer: %w", streamID, cerr)
			}
			captureErr = nil

		case <-ticker.C:
			p.doEmit(st, emitCh)

		case f, ok := <-frames:
			if !ok {
				if err := pollAsyncErr(receiveErrs); err != nil {
					return fmt.Errorf("pipeline %s: transport receive: %w", streamID, err)
				}
				if err := pollAsyncErr(sendErrs); err != nil {
					return fmt.Errorf("pipeline %s: transport send: %w", streamID, err)
				}
				if err := p.advanceAndCheckpoint(runCtx, st, ap, cp, ack); err != nil {
					return err
				}
				if len(st.reorderBuf) > 0 {
					return fmt.Errorf("pipeline %s: transport closed with %d buffered frame(s), next seq=%d: %w",
						streamID, len(st.reorderBuf), st.appliedSeq+1, ErrNonContiguousStream)
				}
				p.doEmit(st, emitCh)
				return nil
			}
			if err := p.ingest(runCtx, st, f, ap, cp, ack); err != nil {
				return err
			}
			if st.framesApplied-st.lastEmitFrames >= p.cfg.EmitEveryFrames {
				p.doEmit(st, emitCh)
			}
		}
	}
}

type applyState struct {
	streamID    string
	appliedSeq  uint64
	sourceLSN   string
	sourceAcker SourceLSNAcker
	reorderBuf  map[uint64]Frame

	bytesApplied  uint64
	framesApplied uint64
	reorderBytes  uint64
	lastLag       time.Duration
	lastApplyAt   time.Time

	lastEmit       time.Time
	lastEmitBytes  uint64
	lastEmitFrames uint64
}

func (p *Pipeline) ingest(ctx context.Context, st *applyState, f Frame, ap Applier, cp Checkpointer, ack func(uint64)) error {
	if err := validateFrameForApply(st.streamID, f); err != nil {
		return err
	}
	if f.Seq <= st.appliedSeq {
		return nil
	}
	if _, dup := st.reorderBuf[f.Seq]; dup {
		return nil
	}
	if len(st.reorderBuf) >= p.cfg.MaxReorderFrames {
		return fmt.Errorf("pipeline %s: reorder buffer has %d frame(s), max %d: %w",
			st.streamID, len(st.reorderBuf), p.cfg.MaxReorderFrames, ErrReorderBufferFull)
	}
	payloadBytes := uint64(len(f.Payload))
	if st.reorderBytes+payloadBytes > p.cfg.MaxReorderBytes {
		return fmt.Errorf("pipeline %s: reorder buffer has %d bytes, adding %d exceeds max %d: %w",
			st.streamID, st.reorderBytes, payloadBytes, p.cfg.MaxReorderBytes, ErrReorderBufferFull)
	}
	st.reorderBuf[f.Seq] = f
	st.reorderBytes += payloadBytes
	return p.advanceAndCheckpoint(ctx, st, ap, cp, ack)
}

func (p *Pipeline) advanceAndCheckpoint(ctx context.Context, st *applyState, ap Applier, cp Checkpointer, ack func(uint64)) error {
	advanced := false
	for {
		next := st.appliedSeq + 1
		f, ok := st.reorderBuf[next]
		if !ok {
			break
		}
		if err := validateFrameForApplier(st.streamID, f, ap); err != nil {
			return err
		}
		appliedSeq, err := ap.Apply(ctx, f)
		if err != nil {
			return fmt.Errorf("pipeline %s: apply seq=%d: %w", st.streamID, f.Seq, err)
		}
		if appliedSeq != f.Seq {
			return fmt.Errorf("pipeline %s: apply seq=%d returned applied seq=%d", st.streamID, f.Seq, appliedSeq)
		}
		delete(st.reorderBuf, next)
		payloadBytes := uint64(len(f.Payload))
		if payloadBytes >= st.reorderBytes {
			st.reorderBytes = 0
		} else {
			st.reorderBytes -= payloadBytes
		}
		st.appliedSeq = next
		st.sourceLSN = f.SourceLSN
		st.bytesApplied += uint64(len(f.Payload))
		st.framesApplied++
		st.lastApplyAt = p.now()
		if !f.EmittedAt.IsZero() {
			st.lastLag = st.lastApplyAt.Sub(f.EmittedAt)
			if p.metrics != nil {
				p.metrics.ReplicationLag.WithLabelValues(st.streamID).Set(st.lastLag.Seconds())
			}
		}
		advanced = true
	}
	if !advanced {
		return nil
	}
	if err := cp.Save(ctx, Checkpoint{
		StreamID:   st.streamID,
		AppliedSeq: st.appliedSeq,
		SourceLSN:  st.sourceLSN,
		AppliedAt:  st.lastApplyAt,
	}); err != nil {
		return fmt.Errorf("pipeline %s: save checkpoint seq=%d: %w", st.streamID, st.appliedSeq, err)
	}
	if st.sourceAcker != nil && st.sourceLSN != "" {
		if err := st.sourceAcker.AckSourceLSN(ctx, st.sourceLSN); err != nil {
			return fmt.Errorf("pipeline %s: ack source LSN %q: %w", st.streamID, st.sourceLSN, err)
		}
	}
	if ack != nil {
		ack(st.appliedSeq)
	}
	return nil
}

func optionalSourceLSNAcker(c Capturer) SourceLSNAcker {
	if acker, ok := c.(SourceLSNAcker); ok {
		return acker
	}
	return nil
}

func validateFrameForApply(streamID string, f Frame) error {
	if f.StreamID != streamID {
		return fmt.Errorf("pipeline %s: frame seq=%d belongs to stream %q", streamID, f.Seq, f.StreamID)
	}
	if f.Seq == 0 {
		return fmt.Errorf("pipeline %s: frame sequence must start at 1", streamID)
	}
	if !f.Kind.Valid() {
		return fmt.Errorf("pipeline %s: frame seq=%d has invalid kind %d", streamID, f.Seq, f.Kind)
	}
	return nil
}

func validateFrameForApplier(streamID string, f Frame, ap Applier) error {
	if !kindCompatible(f.Kind, ap.Kind()) {
		return fmt.Errorf("pipeline %s: frame seq=%d kind %s cannot be applied by %s applier",
			streamID, f.Seq, f.Kind.String(), ap.Kind().String())
	}
	return nil
}

// kindCompatible reports whether a frame of kind fk may be applied by an
// applier that declares kind ak. A frame is compatible when:
//   - its kind matches the applier exactly;
//   - it is a MARKER (consistency point — every applier records markers);
//   - it is a SNAPSHOT_CHUNK and the applier is a WAL applier. A snapshot is
//     the initial bulk load that precedes the change log on the SAME database
//     stream, so a DB (WAL) applier upserts snapshot rows identically to log
//     rows. This is the snapshot→incremental handoff in CDC capture.
func kindCompatible(fk, ak FrameKind) bool {
	if fk == ak || fk == FrameKindMarker {
		return true
	}
	if fk == FrameKindSnapshotChunk && ak == FrameKindWAL {
		return true
	}
	return false
}

func pollAsyncErr(errs <-chan error) error {
	if errs == nil {
		return nil
	}
	select {
	case err, ok := <-errs:
		if !ok {
			return nil
		}
		return err
	default:
		return nil
	}
}

func startProgressEmitter(emit EmitFunc, shutdownTimeout time.Duration) (chan Progress, func()) {
	if emit == nil {
		return nil, func() {}
	}
	ch := make(chan Progress, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for pr := range ch {
			emit(pr)
		}
	}()
	stop := func() {
		close(ch)
		select {
		case <-done:
		case <-time.After(shutdownTimeout):
		}
	}
	return ch, stop
}

func (p *Pipeline) doEmit(st *applyState, emit chan Progress) {
	if emit == nil {
		return
	}
	now := p.now()
	window := now.Sub(st.lastEmit).Seconds()
	var bps float64
	if window > 0 {
		bps = float64(st.bytesApplied-st.lastEmitBytes) / window
	}
	pr := Progress{
		StreamID:      st.streamID,
		AppliedSeq:    st.appliedSeq,
		BytesApplied:  st.bytesApplied,
		FramesApplied: st.framesApplied,
		Lag:           st.lastLag,
		ThroughputBPS: bps,
		BufferDepth:   len(st.reorderBuf),
	}
	select {
	case emit <- pr:
	default:
		select {
		case <-emit:
		default:
		}
		select {
		case emit <- pr:
		default:
		}
	}
	st.lastEmit = now
	st.lastEmitBytes = st.bytesApplied
	st.lastEmitFrames = st.framesApplied
}
