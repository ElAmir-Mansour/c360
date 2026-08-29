package agent

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/datastream/core"
)

// SourceKind selects which shared replication-core Capturer the agent runs for
// a configured source.
type SourceKind string

const (
	// SourceFile is a file-delta capture of a local directory tree.
	SourceFile SourceKind = "file"
	// SourcePostgres is a PostgreSQL change capture (logical replication / WAL).
	SourcePostgres SourceKind = "postgres"
)

// PostgresMode selects the PostgreSQL capture driver.
type PostgresMode string

const (
	// PostgresModeWatermark captures a snapshot plus watermark-polled changes.
	PostgresModeWatermark PostgresMode = "watermark"
	// PostgresModeLogical captures from a logical replication slot (pgoutput or
	// wal2json) and resumes from PostgreSQL LSNs.
	PostgresModeLogical PostgresMode = "logical"
)

// SourceSpec describes one local source the agent captures and ships. StreamID
// is the control-plane replication_stream id this source feeds; it is also the
// key under which the local checkpoint cache resumes.
type SourceSpec struct {
	// StreamID is the replication_stream id (the core StreamID) this source feeds.
	StreamID string
	// Kind selects the Capturer.
	Kind SourceKind
	// Path is the local directory for SourceFile sources.
	Path string
	// DSN is the PostgreSQL connection string for SourcePostgres sources.
	DSN string
	// PostgresMode selects watermark polling or logical replication. Empty
	// defaults to logical when PGLogical is populated, otherwise watermark.
	PostgresMode PostgresMode
	// PGTable describes the table to capture for SourcePostgres sources
	// (table, columns, primary key, and for watermark mode the monotonic
	// watermark column).
	PGTable PGTableSpec
	// PGLogical describes the logical replication slot/plugin for logical mode.
	PGLogical PGLogicalSpec
	// DEK is the 32-byte AES-256 per-stream data key used to encrypt frames on
	// the wire. The control plane decrypts with the same key (per-tenant DEK).
	DEK []byte
}

// PGTableSpec is the agent-facing description of a PostgreSQL table to capture.
// It maps directly onto the shared-core PGTableConfig.
type PGTableSpec struct {
	Schema     string   `json:"schema,omitempty"`
	Table      string   `json:"table"`
	Columns    []string `json:"columns"`
	PrimaryKey []string `json:"primary_key"`
	Watermark  string   `json:"watermark"`
}

// PGLogicalSpec configures PostgreSQL logical replication for a source.
type PGLogicalSpec struct {
	SlotName     string
	Plugin       string
	Publications []string
	PluginArgs   []string
}

// CapturerFactory builds a Capturer for a source, resuming from cp. It is
// injectable so the runtime stays free of source-driver construction details
// (and tests can supply a deterministic capturer). The default factory wires the
// shared-core FileCapturer / PostgreSQL capturer.
type CapturerFactory func(ctx context.Context, spec SourceSpec, cp Checkpoint) (core.Capturer, error)

// Config is the reusable agent runtime configuration. It carries the enrolled
// identity, the ingest endpoint, the local checkpoint cache, and the source
// specs to capture and ship.
type Config struct {
	// IngestURL is the base URL of the control-plane mTLS ingest listener.
	IngestURL string
	// Identity is the enrolled mTLS client identity (cert + key + CA chain).
	Identity *Identity
	// IdentityProvider overrides Identity when the caller needs hot certificate
	// rotation. If nil, Identity is wrapped in a static provider.
	IdentityProvider IdentityProvider
	// Sources are the local sources to capture and ship, one stream each.
	Sources []SourceSpec
	// Checkpoints is the durable local resume cache.
	Checkpoints CheckpointStore
	// CapturerFactory builds the Capturer for each source (defaults to the
	// shared-core capturers).
	CapturerFactory CapturerFactory
	// ReconnectBackoff is the base backoff between reconnect attempts after a link
	// drop (default 1s, capped at MaxReconnectBackoff).
	ReconnectBackoff time.Duration
	// MaxReconnectBackoff caps the exponential reconnect backoff (default 30s).
	MaxReconnectBackoff time.Duration
	// ThrottleBytesPerSec, when > 0, byte-rate-limits each stream's send path.
	ThrottleBytesPerSec float64
	// Metrics, when set, records bytes/frames shipped and resume counts.
	Metrics *core.Metrics
	// ServerName overrides the ingest TLS verification name (tests).
	ServerName string
	// InsecureSkipVerify disables ingest server verification (loopback tests only).
	InsecureSkipVerify bool
	// Logger is the structured logger.
	Logger zerolog.Logger
}

// Runtime is the reusable clario-dr-agent runtime: it captures every configured
// source and ships its frame stream to the control plane over mTLS, resuming
// each stream from the durable local checkpoint and reconnecting on link drops.
type Runtime struct {
	cfg         Config
	factory     CapturerFactory
	logger      zerolog.Logger
	statusMu    sync.RWMutex
	streamOrder []string
	streams     map[string]StreamRuntimeStatus
}

// NewRuntime constructs a Runtime, validating the required wiring.
func NewRuntime(cfg Config) (*Runtime, error) {
	if cfg.IdentityProvider == nil {
		provider, err := NewMutableIdentityProvider(cfg.Identity)
		if err != nil {
			return nil, errors.New("agent: runtime requires an enrolled identity")
		}
		cfg.IdentityProvider = provider
	}
	identity, err := cfg.IdentityProvider.Identity()
	if err != nil || identity == nil {
		return nil, errors.New("agent: runtime requires an enrolled identity")
	}
	if cfg.IngestURL == "" {
		return nil, errors.New("agent: runtime requires an ingest URL")
	}
	if cfg.Checkpoints == nil {
		return nil, errors.New("agent: runtime requires a checkpoint store")
	}
	if len(cfg.Sources) == 0 {
		return nil, errors.New("agent: runtime requires at least one source")
	}
	for i, s := range cfg.Sources {
		if s.StreamID == "" {
			return nil, fmt.Errorf("agent: source %d is missing a stream id", i)
		}
		if len(s.DEK) != core.AESKeySize256 {
			return nil, fmt.Errorf("agent: source %s DEK must be %d bytes", s.StreamID, core.AESKeySize256)
		}
		switch s.Kind {
		case SourceFile:
			if s.Path == "" {
				return nil, fmt.Errorf("agent: file source %s requires a path", s.StreamID)
			}
		case SourcePostgres:
			if s.DSN == "" {
				return nil, fmt.Errorf("agent: postgres source %s requires a DSN", s.StreamID)
			}
			if s.PGTable.Table == "" {
				return nil, fmt.Errorf("agent: postgres source %s requires a table", s.StreamID)
			}
			if len(s.PGTable.Columns) == 0 {
				return nil, fmt.Errorf("agent: postgres source %s requires columns", s.StreamID)
			}
			if len(s.PGTable.PrimaryKey) == 0 {
				return nil, fmt.Errorf("agent: postgres source %s requires a primary key", s.StreamID)
			}
			switch mode := s.normalizedPostgresMode(); mode {
			case PostgresModeWatermark:
				if s.PGTable.Watermark == "" {
					return nil, fmt.Errorf("agent: postgres source %s requires a watermark in watermark mode", s.StreamID)
				}
			case PostgresModeLogical:
				if s.PGLogical.SlotName == "" {
					return nil, fmt.Errorf("agent: postgres source %s requires a logical replication slot_name", s.StreamID)
				}
				switch s.normalizedLogicalPlugin() {
				case "pgoutput":
					if len(s.PGLogical.Publications) == 0 && len(s.PGLogical.PluginArgs) == 0 {
						return nil, fmt.Errorf("agent: postgres source %s pgoutput mode requires publications or plugin_args", s.StreamID)
					}
				case "wal2json":
				default:
					return nil, fmt.Errorf("agent: postgres source %s has unsupported logical plugin %q", s.StreamID, s.PGLogical.Plugin)
				}
			default:
				return nil, fmt.Errorf("agent: postgres source %s has unsupported postgres mode %q", s.StreamID, s.PostgresMode)
			}
		default:
			return nil, fmt.Errorf("agent: source %s has unsupported kind %q", s.StreamID, s.Kind)
		}
	}
	factory := cfg.CapturerFactory
	if factory == nil {
		factory = DefaultCapturerFactory
	}
	if cfg.ReconnectBackoff <= 0 {
		cfg.ReconnectBackoff = time.Second
	}
	if cfg.MaxReconnectBackoff <= 0 {
		cfg.MaxReconnectBackoff = 30 * time.Second
	}
	if cfg.MaxReconnectBackoff < cfg.ReconnectBackoff {
		return nil, errors.New("agent: max reconnect backoff must be >= reconnect backoff")
	}
	now := time.Now().UTC()
	streamOrder := make([]string, 0, len(cfg.Sources))
	streams := make(map[string]StreamRuntimeStatus, len(cfg.Sources))
	for _, spec := range cfg.Sources {
		streamOrder = append(streamOrder, spec.StreamID)
		streams[spec.StreamID] = StreamRuntimeStatus{
			StreamID:  spec.StreamID,
			Kind:      spec.Kind,
			Phase:     StreamPhaseConfigured,
			UpdatedAt: now,
		}
	}
	return &Runtime{
		cfg:         cfg,
		factory:     factory,
		logger:      cfg.Logger.With().Str("component", "dr-agent-runtime").Logger(),
		streamOrder: streamOrder,
		streams:     streams,
	}, nil
}

// Run captures and ships every configured source concurrently until ctx is
// cancelled (graceful shutdown) or every stream has reached a terminal,
// non-recoverable error. It returns the first non-recoverable error, or nil on
// a clean ctx-cancelled shutdown.
func (r *Runtime) Run(ctx context.Context) error {
	var wg sync.WaitGroup
	errCh := make(chan error, len(r.cfg.Sources))
	for _, spec := range r.cfg.Sources {
		spec := spec
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := r.runStream(ctx, spec); err != nil {
				errCh <- fmt.Errorf("stream %s: %w", spec.StreamID, err)
			}
		}()
	}
	wg.Wait()
	close(errCh)

	var firstErr error
	for err := range errCh {
		if firstErr == nil {
			firstErr = err
		}
		r.logger.Error().Err(err).Msg("stream terminated with error")
	}
	if ctx.Err() != nil {
		// Shutdown requested: a per-stream ctx-cancellation is expected and clean.
		return nil
	}
	return firstErr
}

// runStream captures one source and ships it, resuming from the local
// checkpoint and reconnecting on recoverable link drops. It returns nil on a
// clean ctx-cancelled shutdown and a non-recoverable error otherwise.
func (r *Runtime) runStream(ctx context.Context, spec SourceSpec) error {
	log := r.logger.With().Str("stream_id", spec.StreamID).Str("kind", string(spec.Kind)).Logger()
	r.markStreamStarting(spec)
	identity, err := r.cfg.IdentityProvider.Identity()
	if err != nil {
		r.markStreamFailed(spec.StreamID, err)
		return err
	}

	shipper, err := NewShipTransport(ShipConfig{
		IngestURL:          r.cfg.IngestURL,
		StreamID:           spec.StreamID,
		ClientCertProvider: r.currentClientCert,
		CAChainPEM:         identity.CAChainPEM,
		DEK:                spec.DEK,
		ServerName:         r.cfg.ServerName,
		Throttle:           r.buildThrottle(),
		Metrics:            r.cfg.Metrics,
		MetricsLabel:       "dr-agent",
		InsecureSkipVerify: r.cfg.InsecureSkipVerify,
	})
	if err != nil {
		r.markStreamFailed(spec.StreamID, err)
		return err
	}

	backoff := r.cfg.ReconnectBackoff
	for {
		if ctx.Err() != nil {
			return nil
		}

		// Resume cursor: the higher of the durable local checkpoint and the
		// transport's in-memory ack (both reflect the same control-plane truth;
		// taking the max is defensive against either lagging).
		cp, err := r.cfg.Checkpoints.Load(spec.StreamID)
		if err != nil {
			r.markStreamFailed(spec.StreamID, err)
			return fmt.Errorf("load checkpoint: %w", err)
		}
		resumeFrom := cp.AckedSeq
		if rf := shipper.ResumeFrom(); rf > resumeFrom {
			resumeFrom = rf
		}
		cp.AckedSeq = resumeFrom
		log.Info().Uint64("resume_from", resumeFrom).Msg("starting capture+ship session")
		r.markStreamShipping(spec.StreamID, resumeFrom)

		shipErr := r.captureAndShip(ctx, spec, shipper, cp)
		if ctx.Err() != nil {
			r.markStreamStopped(spec.StreamID)
			return nil
		}
		if shipErr == nil {
			// Clean drain: the capturer reached the end of its source (e.g. a
			// one-shot file snapshot). Nothing more to ship for this stream.
			log.Info().Uint64("acked", shipper.ResumeFrom()).Msg("stream fully shipped")
			r.markStreamCompleted(spec.StreamID)
			return nil
		}
		if !errors.Is(shipErr, ErrLinkDropped) {
			r.markStreamFailed(spec.StreamID, shipErr)
			return shipErr
		}

		// Recoverable link drop: back off and reconnect; the next session resumes
		// from the durable checkpoint with no loss and no duplicates.
		log.Warn().Err(shipErr).Dur("backoff", backoff).Msg("link dropped; reconnecting")
		r.markStreamReconnecting(spec.StreamID, shipErr, backoff)
		select {
		case <-ctx.Done():
			r.markStreamStopped(spec.StreamID)
			return nil
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > r.cfg.MaxReconnectBackoff {
			backoff = r.cfg.MaxReconnectBackoff
		}
	}
}

// captureAndShip runs the Capturer from cp into a channel and ships that
// channel over the transport in a single session. It returns when the capturer
// drains (clean), the ship link drops (ErrLinkDropped), the capturer errors, or
// ctx is cancelled.
func (r *Runtime) captureAndShip(ctx context.Context, spec SourceSpec, shipper *ShipTransport, cp Checkpoint) error {
	sessionCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	capturer, err := r.factory(sessionCtx, spec, cp)
	if err != nil {
		return fmt.Errorf("build capturer: %w", err)
	}
	defer capturer.Close()

	sourceAcker, _ := capturer.(core.SourceLSNAcker)
	shipper.SetCheckpointObserver(func(cp Checkpoint) {
		r.observeDurableCheckpoint(sessionCtx, spec, cp, sourceAcker)
	})
	defer shipper.SetCheckpointObserver(nil)

	resumeFrom := cp.AckedSeq
	frames := make(chan core.Frame, 64)
	captureErr := make(chan error, 1)
	go func() {
		captureErr <- capturer.Start(sessionCtx, resumeFrom, frames)
		close(frames)
	}()

	// Ship drains frames over the mTLS link until frames closes (capturer drained
	// → clean), the link drops (ErrLinkDropped), or ctx cancels.
	shipErr := shipper.Ship(sessionCtx, r.observeStreamFrames(sessionCtx, spec.StreamID, frames))

	// Stop the capturer for this session and reap its error.
	cancel()
	cErr := <-captureErr

	if shipErr != nil {
		return shipErr
	}
	if cErr != nil && !errors.Is(cErr, context.Canceled) {
		return fmt.Errorf("capture: %w", cErr)
	}
	return nil
}

// observeDurableCheckpoint handles the control plane's durable ack for a frame:
// first persist the agent-local restart cursor, then tell source capturers that
// support source LSN acknowledgements that the downstream side has durably
// checkpointed through that source cursor.
func (r *Runtime) observeDurableCheckpoint(ctx context.Context, spec SourceSpec, cp Checkpoint, sourceAcker core.SourceLSNAcker) {
	if cp.AckedSeq == 0 {
		return
	}
	if cp.StreamID == "" {
		cp.StreamID = spec.StreamID
	}
	if cp.UpdatedAt.IsZero() {
		cp.UpdatedAt = time.Now().UTC()
	}

	log := r.logger.With().Str("stream_id", spec.StreamID).Logger()
	r.markStreamAcked(spec.StreamID, cp)
	durable := Checkpoint{
		StreamID:  spec.StreamID,
		AckedSeq:  cp.AckedSeq,
		SourceLSN: cp.SourceLSN,
		UpdatedAt: cp.UpdatedAt,
	}
	if err := r.cfg.Checkpoints.Save(durable); err != nil {
		log.Warn().Err(err).Uint64("seq", cp.AckedSeq).Msg("failed to persist local checkpoint")
		return
	}
	if sourceAcker == nil || cp.SourceLSN == "" {
		return
	}
	if err := sourceAcker.AckSourceLSN(ctx, cp.SourceLSN); err != nil {
		log.Warn().Err(err).Str("source_lsn", cp.SourceLSN).Uint64("seq", cp.AckedSeq).Msg("failed to ack source LSN")
	}
}

func (r *Runtime) buildThrottle() *core.TokenBucket {
	if r.cfg.ThrottleBytesPerSec <= 0 {
		return nil
	}
	return core.NewTokenBucket(r.cfg.ThrottleBytesPerSec, r.cfg.ThrottleBytesPerSec, nil)
}

func (r *Runtime) currentClientCert() (tls.Certificate, error) {
	identity, err := r.cfg.IdentityProvider.Identity()
	if err != nil {
		return tls.Certificate{}, err
	}
	return identity.Certificate, nil
}

// DefaultCapturerFactory builds the shared replication-core Capturer for a
// source spec. For file sources it walks the directory from a fresh baseline
// (a from-scratch capture ships every block; the control plane de-dupes via the
// resume cursor). For postgres sources it wires the logical-replication
// capturer. It is the production factory used by cmd/clario-dr-agent.
func DefaultCapturerFactory(ctx context.Context, spec SourceSpec, cp Checkpoint) (core.Capturer, error) {
	switch spec.Kind {
	case SourceFile:
		return core.NewFileCapturer(spec.StreamID, spec.Path, core.NewFileBaseline())
	case SourcePostgres:
		return newPostgresCapturer(ctx, spec, cp)
	default:
		return nil, fmt.Errorf("agent: unsupported source kind %q", spec.Kind)
	}
}

func (s SourceSpec) normalizedPostgresMode() PostgresMode {
	if s.PostgresMode != "" {
		return PostgresMode(strings.ToLower(strings.TrimSpace(string(s.PostgresMode))))
	}
	if s.PGLogical.SlotName != "" || s.PGLogical.Plugin != "" || len(s.PGLogical.Publications) > 0 || len(s.PGLogical.PluginArgs) > 0 {
		return PostgresModeLogical
	}
	return PostgresModeWatermark
}

func (s SourceSpec) normalizedLogicalPlugin() string {
	if s.PGLogical.Plugin == "" {
		return "pgoutput"
	}
	return strings.ToLower(strings.TrimSpace(s.PGLogical.Plugin))
}
