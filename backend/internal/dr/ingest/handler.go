package ingest

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/siem/sources/pki"
	"github.com/clario360/platform/internal/suiteapi"
)

var (
	// ErrNotConfigured is returned when the ingest package is mounted without a
	// required dependency.
	ErrNotConfigured = errors.New("dr ingest: dependency not configured")
	// ErrValidation is returned for malformed stream input.
	ErrValidation = errors.New("dr ingest: validation failed")
	// ErrUnauthorized is returned when an authenticated agent is not allowed to
	// ship the target stream.
	ErrUnauthorized = errors.New("dr ingest: unauthorized")
)

// DEKProvider returns the per-tenant/per-stream AES-256 DEK used by the core
// transport to decrypt inbound payloads.
type DEKProvider interface {
	DEK(ctx context.Context, identity Identity, streamID string) ([]byte, error)
}

// ApplierFactory returns the stream applier for an authenticated agent.
type ApplierFactory interface {
	ApplierFor(ctx context.Context, identity Identity, streamID string) (core.Applier, error)
}

// MultiKindApplier is optionally implemented by appliers that can safely handle
// more than one frame kind, such as the DR applied-frame store applier.
type MultiKindApplier interface {
	AcceptsKind(kind core.FrameKind) bool
}

// CheckpointerFactory returns the ledger checkpointer for a stream.
type CheckpointerFactory interface {
	CheckpointerFor(ctx context.Context, identity Identity, streamID string) (core.Checkpointer, error)
}

// StreamAuthorizer verifies that an authenticated agent may ship a stream.
type StreamAuthorizer interface {
	AuthorizeStream(ctx context.Context, identity Identity, streamID string) error
}

// Ledger records successful checkpoint advances for RPO/progress observers.
// The Checkpointer remains the durable RPO ledger; this hook is for injected
// side effects such as metrics or direct progress publishing.
type Ledger interface {
	RecordApply(ctx context.Context, identity Identity, checkpoint core.Checkpoint) error
}

// Dependencies holds the production wiring for the ingest handler.
type Dependencies struct {
	AgentLookup AgentLookup
	CRL         *pki.CRLCache
	CacheTTL    time.Duration

	DEKProvider DEKProvider
	Appliers    ApplierFactory
	Checkpoints CheckpointerFactory
	Authorizer  StreamAuthorizer
	Ledger      Ledger
	Metrics     *core.Metrics
	Logger      zerolog.Logger
	Now         func() time.Time
}

// Handler receives encrypted frame streams from authenticated DR agents.
type Handler struct {
	deps       Dependencies
	middleware *Middleware
	now        func() time.Time
	logger     zerolog.Logger
}

// NewHandler constructs a Handler.
func NewHandler(deps Dependencies) *Handler {
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	var mw *Middleware
	if deps.AgentLookup != nil {
		mw = NewMiddleware(deps.AgentLookup, deps.CRL, deps.CacheTTL)
	}
	return &Handler{
		deps:       deps,
		middleware: mw,
		now:        now,
		logger:     deps.Logger.With().Str("handler", "dr-ingest").Logger(),
	}
}

// Routes returns the mTLS-only ingest routes. Main should mount this router on
// the dedicated mTLS listener, not on the public tenant API router.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	if h.middleware != nil {
		r.Use(h.middleware.Handler)
	}
	r.Post("/streams/{streamID}/frames", h.IngestHTTP)
	return r
}

// Result summarizes one receive session.
type Result struct {
	StreamID      string `json:"stream_id"`
	FramesApplied int    `json:"frames_applied"`
	AppliedSeq    uint64 `json:"applied_seq"`
}

type session struct {
	h          *Handler
	identity   Identity
	streamID   string
	transport  *core.StreamTransport
	applier    core.Applier
	checkpoint core.Checkpointer
}

func (h *Handler) prepareSession(ctx context.Context, identity Identity, streamID string) (*session, error) {
	if h == nil || h.deps.DEKProvider == nil || h.deps.Appliers == nil || h.deps.Checkpoints == nil {
		return nil, ErrNotConfigured
	}
	if identity.AgentID == uuid.Nil || identity.TenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: authenticated identity is required", ErrUnauthorized)
	}
	if streamID == "" {
		return nil, fmt.Errorf("%w: stream id is required", ErrValidation)
	}
	if h.deps.Authorizer != nil {
		if err := h.deps.Authorizer.AuthorizeStream(ctx, identity, streamID); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrUnauthorized, err)
		}
	}
	dek, err := h.deps.DEKProvider.DEK(ctx, identity, streamID)
	if err != nil {
		return nil, err
	}
	key := append([]byte(nil), dek...)
	defer zero(key)

	tr, err := core.NewStreamTransport(key, core.WithStreamMetrics(h.deps.Metrics, "dr-ingest"))
	if err != nil {
		return nil, err
	}
	applier, err := h.deps.Appliers.ApplierFor(ctx, identity, streamID)
	if err != nil {
		return nil, err
	}
	if applier == nil {
		return nil, ErrNotConfigured
	}
	checkpointer, err := h.deps.Checkpoints.CheckpointerFor(ctx, identity, streamID)
	if err != nil {
		return nil, err
	}
	if checkpointer == nil {
		return nil, ErrNotConfigured
	}
	return &session{h: h, identity: identity, streamID: streamID, transport: tr, applier: applier, checkpoint: checkpointer}, nil
}

// HandleConn receives frames from conn, applies contiguous frames, persists the
// checkpoint, and acks the durable cursor back over conn.Ack().
func (h *Handler) HandleConn(ctx context.Context, identity Identity, streamID string, conn core.Conn) (Result, error) {
	sess, err := h.prepareSession(ctx, identity, streamID)
	if err != nil {
		return Result{}, err
	}
	return sess.receive(ctx, conn)
}

func (s *session) receive(ctx context.Context, conn core.Conn) (Result, error) {
	if conn == nil {
		return Result{}, fmt.Errorf("%w: connection is required", ErrValidation)
	}
	defer conn.Close()

	cp, err := s.checkpoint.Load(ctx, s.streamID)
	if err != nil {
		return Result{}, err
	}
	last := cp.AppliedSeq
	result := Result{StreamID: s.streamID, AppliedSeq: last}

	frames, ack, errs := s.transport.ReceiveOver(ctx, conn)
	for f := range frames {
		next, applied, err := s.applyFrame(ctx, f, last)
		if err != nil {
			return result, err
		}
		last = next
		result.AppliedSeq = last
		if applied {
			result.FramesApplied++
		}
		if ack != nil {
			ack(last)
		}
	}
	if err := <-errs; err != nil {
		return result, err
	}
	return result, nil
}

func (s *session) applyFrame(ctx context.Context, f core.Frame, last uint64) (next uint64, applied bool, err error) {
	if f.StreamID != s.streamID {
		return last, false, fmt.Errorf("%w: frame stream %q does not match route stream %q", ErrValidation, f.StreamID, s.streamID)
	}
	if f.Seq <= last {
		return last, false, nil
	}
	if f.Seq != last+1 {
		return last, false, fmt.Errorf("%w: non-contiguous seq %d after %d", ErrValidation, f.Seq, last)
	}
	if !applierAccepts(s.applier, f.Kind) {
		return last, false, fmt.Errorf("%w: frame kind %s cannot be applied by %s applier", ErrValidation, f.Kind.String(), s.applier.Kind().String())
	}
	if s.h.deps.Authorizer != nil {
		if err := s.h.deps.Authorizer.AuthorizeStream(ctx, s.identity, s.streamID); err != nil {
			return last, false, fmt.Errorf("%w: %v", ErrUnauthorized, err)
		}
	}
	appliedSeq, err := s.applier.Apply(ctx, f)
	if err != nil {
		return last, false, err
	}
	if appliedSeq != f.Seq {
		return last, false, fmt.Errorf("%w: applier returned seq %d for frame %d", ErrValidation, appliedSeq, f.Seq)
	}
	cp := core.Checkpoint{
		StreamID:   s.streamID,
		AppliedSeq: appliedSeq,
		SourceLSN:  f.SourceLSN,
		AppliedAt:  s.h.now().UTC(),
	}
	if err := s.checkpoint.Save(ctx, cp); err != nil {
		return last, false, err
	}
	if s.h.deps.Ledger != nil {
		if err := s.h.deps.Ledger.RecordApply(ctx, s.identity, cp); err != nil {
			return last, false, err
		}
	}
	return appliedSeq, true, nil
}

// IngestHTTP adapts an mTLS HTTP request body to the core stream transport. The
// binary response body carries 8-byte ack cursors.
func (h *Handler) IngestHTTP(w http.ResponseWriter, r *http.Request) {
	identity, ok := IdentityFromContext(r.Context())
	if !ok {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_identity", "mTLS identity required", nil)
		return
	}
	streamID := chi.URLParam(r, "streamID")
	sess, err := h.prepareSession(r.Context(), identity, streamID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}

	if err := http.NewResponseController(w).EnableFullDuplex(); err != nil {
		h.logger.Debug().Err(err).Msg("full duplex HTTP unavailable; continuing")
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.WriteHeader(http.StatusOK)

	conn := core.SplitConn(readOnlyBody{ReadCloser: r.Body}, writeOnlyResponse{w: w})
	if _, err := sess.receive(r.Context(), conn); err != nil {
		h.logger.Warn().Err(err).Str("stream_id", streamID).Str("agent_id", identity.AgentID.String()).Msg("dr ingest stream failed")
	}
}

func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotConfigured):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "ingest_disabled", err.Error(), nil)
	case errors.Is(err, ErrUnauthorized):
		suiteapi.WriteError(w, r, http.StatusForbidden, "forbidden", err.Error(), nil)
	case errors.Is(err, ErrValidation):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, model.ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr ingest setup failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

func kindCompatible(fk, ak core.FrameKind) bool {
	if fk == ak || fk == core.FrameKindMarker {
		return true
	}
	return fk == core.FrameKindSnapshotChunk && ak == core.FrameKindWAL
}

func applierAccepts(applier core.Applier, kind core.FrameKind) bool {
	if multi, ok := applier.(MultiKindApplier); ok {
		return multi.AcceptsKind(kind)
	}
	return kindCompatible(kind, applier.Kind())
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

type readOnlyBody struct {
	io.ReadCloser
}

func (r readOnlyBody) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

type writeOnlyResponse struct {
	w http.ResponseWriter
}

func (w writeOnlyResponse) Read([]byte) (int, error) { return 0, io.EOF }
func (w writeOnlyResponse) Close() error             { return nil }
func (w writeOnlyResponse) Write(p []byte) (int, error) {
	n, err := w.w.Write(p)
	if flusher, ok := w.w.(http.Flusher); ok {
		flusher.Flush()
	}
	return n, err
}
