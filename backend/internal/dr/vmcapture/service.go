package vmcapture

import (
	"context"
	"errors"
	"fmt"
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

// Event types emitted to the DR events topic as workload capture evolves.
const (
	// EventTypeSourceRegistered announces a newly registered capture source.
	EventTypeSourceRegistered = "dr.workload.source.registered"
	// EventTypeCaptureCompleted announces a completed capture pass (epoch).
	EventTypeCaptureCompleted = "dr.workload.capture.completed"

	eventSource = "clario-dr-service/vmcapture"

	// drEventsTopic is the lifecycle topic (events.Topics.DREvents). Using the
	// literal keeps this package from editing the shared topics file.
	drEventsTopic = "datastream.dr.events"
)

// TenantRunner runs a function inside a tenant-scoped transaction (RLS set).
// *pgxpool.Pool is adapted by PGXRunner; tests supply a fake.
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
		return errors.New("vmcapture: nil transaction pool")
	}
	return database.RunWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunReadWithTenant runs fn in a tenant-scoped read transaction.
func (r PGXRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return errors.New("vmcapture: nil transaction pool")
	}
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// store is the persistence surface the service uses.
type store interface {
	CreateSource(ctx context.Context, db repository.DBTX, s *Source) error
	GetSource(ctx context.Context, db repository.DBTX, tenantID, id string) (*Source, error)
	ListSources(ctx context.Context, db repository.DBTX, tenantID string) ([]Source, error)
	AdvanceSource(ctx context.Context, db repository.DBTX, tenantID, id string, epochCount int, lastSeq int64, runAt time.Time) error
	InsertEpoch(ctx context.Context, db repository.DBTX, e *Epoch) error
	ListEpochs(ctx context.Context, db repository.DBTX, tenantID, sourceID string) ([]Epoch, error)
	LatestEpoch(ctx context.Context, db repository.DBTX, tenantID, sourceID string) (*Epoch, error)
	GetVMState(ctx context.Context, db repository.DBTX, tenantID, sourceID string) (VMState, error)
	UpsertVMState(ctx context.Context, db repository.DBTX, st VMState) error
}

// FrameSink durably records a captured frame after it is produced — the seam to
// the EXISTING replication pipeline. The integration phase supplies an
// implementation backed by internal/dr/framestore (so a captured frame becomes
// an applied frame the recovery-point service can seal); tests supply an
// in-memory sink to assert exactly which frames were emitted.
type FrameSink interface {
	// SinkFrame records one captured frame for a tenant. It must be idempotent
	// on (StreamID, Seq): a replayed frame with identical bytes is a no-op.
	SinkFrame(ctx context.Context, tenantID uuid.UUID, frame core.Frame) error
}

// BindingFactory builds the per-source capture binding from a stored source.
// External systems (hypervisors, clusters) are injected here so the service has
// no compile-time dependency on them; the default factory handles the real,
// tested file (VM) and fixture/REST (K8s) bindings.
type BindingFactory interface {
	// VMBinding returns the hypervisor binding for a vm_disk source.
	VMBinding(ctx context.Context, s *Source) (HypervisorBinding, error)
	// K8sSource returns the resource source for a k8s_workload source.
	K8sSource(ctx context.Context, s *Source) (ResourceSource, error)
}

// Service is the request-path API for workload capture: register/list sources,
// trigger a capture pass, list epochs. A source write and a capture pass each
// run inside a tenant-scoped transaction and stage their lifecycle event in the
// same transaction via the outbox so state and event commit together.
type Service struct {
	runner  TenantRunner
	store   store
	sink    FrameSink
	factory BindingFactory
	metrics *Metrics
	logger  zerolog.Logger
	now     func() time.Time
}

// ServiceConfig wires a Service. Runner, Store, Sink and Factory are required.
type ServiceConfig struct {
	Runner  TenantRunner
	Store   store
	Sink    FrameSink
	Factory BindingFactory
	Metrics *Metrics
	Logger  zerolog.Logger
	Now     func() time.Time
}

// NewService constructs the workload-capture service.
func NewService(cfg ServiceConfig) (*Service, error) {
	if cfg.Runner == nil {
		return nil, errors.New("vmcapture service: tenant runner is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("vmcapture service: store is required")
	}
	if cfg.Sink == nil {
		return nil, errors.New("vmcapture service: frame sink is required")
	}
	if cfg.Factory == nil {
		return nil, errors.New("vmcapture service: binding factory is required")
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		runner:  cfg.Runner,
		store:   cfg.Store,
		sink:    cfg.Sink,
		factory: cfg.Factory,
		metrics: cfg.Metrics,
		logger:  cfg.Logger.With().Str("service", "dr-vmcapture").Logger(),
		now:     now,
	}, nil
}

// RegisterInput is the request body for POST /workload-captures.
type RegisterInput struct {
	StreamID       string         `json:"stream_id"`
	Name           string         `json:"name"`
	SourceKind     string         `json:"source_kind"`
	BindingKind    string         `json:"binding_kind"`
	BlockSizeBytes int            `json:"block_size_bytes"`
	Config         map[string]any `json:"config"`
	Enabled        *bool          `json:"enabled"`
}

// RegisterSource validates and persists a capture source and stages a
// registration event in the same transaction.
func (s *Service) RegisterSource(ctx context.Context, tenantID uuid.UUID, in RegisterInput) (*Source, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalid)
	}
	streamID, err := uuid.Parse(in.StreamID)
	if err != nil {
		return nil, fmt.Errorf("%w: stream_id must be a UUID", ErrInvalid)
	}
	if in.Name == "" {
		return nil, fmt.Errorf("%w: name is required", ErrInvalid)
	}
	if !ValidSourceKind(in.SourceKind) {
		return nil, fmt.Errorf("%w: source_kind %q", ErrInvalid, in.SourceKind)
	}
	if !ValidBinding(in.SourceKind, in.BindingKind) {
		return nil, fmt.Errorf("%w: binding_kind %q is invalid for source_kind %q", ErrInvalid, in.BindingKind, in.SourceKind)
	}
	blockSize := in.BlockSizeBytes
	if in.SourceKind == SourceKindVMDisk {
		if blockSize <= 0 {
			blockSize = DefaultBlockSize
		}
	} else {
		blockSize = 0
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}

	src := &Source{
		TenantID:       tenantID.String(),
		StreamID:       streamID.String(),
		Name:           in.Name,
		SourceKind:     in.SourceKind,
		BindingKind:    in.BindingKind,
		BlockSizeBytes: blockSize,
		Config:         orEmptyMap(in.Config),
		Enabled:        enabled,
	}

	if err := s.runner.RunWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		if err := s.store.CreateSource(ctx, tx, src); err != nil {
			return err
		}
		evt, err := events.NewEvent(EventTypeSourceRegistered, eventSource, tenantID.String(), map[string]any{
			"source_id":    src.ID,
			"stream_id":    src.StreamID,
			"name":         src.Name,
			"source_kind":  src.SourceKind,
			"binding_kind": src.BindingKind,
		})
		if err != nil {
			return fmt.Errorf("building source-registered event: %w", err)
		}
		return outbox.Write(ctx, tx, drEventsTopic, evt)
	}); err != nil {
		return nil, err
	}

	s.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("source_id", src.ID).
		Str("source_kind", src.SourceKind).
		Str("binding_kind", src.BindingKind).
		Msg("workload capture source registered")
	return src, nil
}

// ListSources returns a tenant's capture sources.
func (s *Service) ListSources(ctx context.Context, tenantID uuid.UUID) ([]Source, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalid)
	}
	var out []Source
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		out, err = s.store.ListSources(ctx, tx, tenantID.String())
		return err
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// ListEpochs returns a source's capture passes.
func (s *Service) ListEpochs(ctx context.Context, tenantID, sourceID uuid.UUID) ([]Epoch, error) {
	if tenantID == uuid.Nil || sourceID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant and source id are required", ErrInvalid)
	}
	var out []Epoch
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		// Confirm the source exists for the tenant so a 404 is returned rather
		// than an empty list for an unknown id.
		if _, err := s.store.GetSource(ctx, tx, tenantID.String(), sourceID.String()); err != nil {
			return err
		}
		var err error
		out, err = s.store.ListEpochs(ctx, tx, tenantID.String(), sourceID.String())
		return err
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// RunCapture triggers one capture pass for a source. The whole pass — load
// prior state, run the capturer (which sinks frames into the pipeline), persist
// the epoch + new state, advance the source, stage the completion event — runs
// in one tenant-scoped transaction so it is atomic. It returns the new epoch.
func (s *Service) RunCapture(ctx context.Context, tenantID, sourceID uuid.UUID) (*Epoch, error) {
	if tenantID == uuid.Nil || sourceID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant and source id are required", ErrInvalid)
	}

	var (
		result *Epoch
		kind   string
	)
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		src, err := s.store.GetSource(ctx, tx, tenantID.String(), sourceID.String())
		if err != nil {
			return err
		}
		kind = src.SourceKind
		if !src.Enabled {
			return fmt.Errorf("source %s: %w", src.ID, ErrDisabled)
		}
		epoch, err := s.runPass(ctx, tx, tenantID, src)
		if err != nil {
			return err
		}
		result = epoch
		return nil
	})
	if err != nil {
		if kind != "" {
			s.metrics.IncFailure(kind)
		}
		return nil, err
	}
	s.metrics.ObserveCapture(result.SourceKindLabel(kind), sourceID.String(), *result)
	s.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("source_id", sourceID.String()).
		Int("epoch", result.Epoch).
		Str("epoch_kind", result.EpochKind).
		Int("changed_units", result.ChangedUnits).
		Int("frame_count", result.FrameCount).
		Msg("workload capture pass completed")
	return result, nil
}

// SourceKindLabel returns the source kind label for metrics, falling back to the
// epoch's stream when not provided.
func (e Epoch) SourceKindLabel(kind string) string {
	if kind != "" {
		return kind
	}
	return "unknown"
}

// runPass executes the capturer for src inside the open tenant transaction tx.
// Frames are produced by the capturer on an internal channel and sunk into the
// pipeline in Seq order; the capturer persists the epoch + state through tx-
// bound adapters so the whole pass is one atomic unit.
func (s *Service) runPass(ctx context.Context, tx repository.DBTX, tenantID uuid.UUID, src *Source) (*Epoch, error) {
	resumeFrom := uint64(0)
	if src.LastSeq > 0 {
		resumeFrom = uint64(src.LastSeq)
	}

	capturer, err := s.buildCapturer(ctx, tx, tenantID, src)
	if err != nil {
		return nil, err
	}
	defer func() { _ = capturer.Close() }()

	// Drain the capturer's frames into the sink in order. The capturer assigns
	// strictly-increasing Seq above resumeFrom; we sink each before reading the
	// next so the framestore append order matches the emit order.
	out := make(chan core.Frame)
	sinkErr := make(chan error, 1)
	go func() {
		var serr error
		for f := range out {
			if serr == nil {
				if e := s.sink.SinkFrame(ctx, tenantID, f); e != nil {
					serr = e
				}
			}
		}
		sinkErr <- serr
	}()

	startErr := capturer.Start(ctx, resumeFrom, out)
	close(out)
	if se := <-sinkErr; se != nil {
		return nil, fmt.Errorf("vmcapture: sink frames: %w", se)
	}
	if startErr != nil {
		return nil, startErr
	}

	epoch := epochFromCapturer(capturer)
	if epoch == nil {
		return nil, fmt.Errorf("%w: capturer produced no epoch", ErrInvalid)
	}

	// Advance the source row and stage the completion event in the same tx.
	if err := s.store.AdvanceSource(ctx, tx, tenantID.String(), src.ID, epoch.Epoch, epoch.ToSeq, s.now()); err != nil {
		return nil, err
	}
	evt, err := events.NewEvent(EventTypeCaptureCompleted, eventSource, tenantID.String(), map[string]any{
		"source_id":     src.ID,
		"stream_id":     src.StreamID,
		"epoch":         epoch.Epoch,
		"epoch_kind":    epoch.EpochKind,
		"changed_units": epoch.ChangedUnits,
		"total_units":   epoch.TotalUnits,
		"frame_count":   epoch.FrameCount,
		"content_hash":  epoch.ContentHash,
	})
	if err != nil {
		return nil, fmt.Errorf("building capture-completed event: %w", err)
	}
	if err := outbox.Write(ctx, tx, drEventsTopic, evt); err != nil {
		return nil, err
	}
	return epoch, nil
}

// buildCapturer constructs the right core.Capturer for src, wiring tx-bound
// state stores so the capturer's epoch/state writes join the open transaction.
func (s *Service) buildCapturer(ctx context.Context, tx repository.DBTX, tenantID uuid.UUID, src *Source) (capturerWithEpoch, error) {
	switch src.SourceKind {
	case SourceKindVMDisk:
		binding, err := s.factory.VMBinding(ctx, src)
		if err != nil {
			return nil, err
		}
		return NewVMDiskCapturer(VMDiskConfig{
			TenantID:  tenantID.String(),
			SourceID:  src.ID,
			StreamID:  src.StreamID,
			Binding:   binding,
			State:     &txVMState{store: s.store, tx: tx, tenantID: tenantID.String()},
			BlockSize: src.BlockSizeBytes,
		})
	case SourceKindK8sWorkload:
		source, err := s.factory.K8sSource(ctx, src)
		if err != nil {
			return nil, err
		}
		return NewK8sWorkloadCapturer(K8sWorkloadConfig{
			TenantID: tenantID.String(),
			SourceID: src.ID,
			StreamID: src.StreamID,
			Source:   source,
			State:    &txK8sState{store: s.store, tx: tx, tenantID: tenantID.String()},
		})
	default:
		return nil, fmt.Errorf("%w: source_kind %q", ErrInvalid, src.SourceKind)
	}
}

// capturerWithEpoch is the common shape of the two capturers: a core.Capturer
// that records the epoch its last Start persisted.
type capturerWithEpoch interface {
	core.Capturer
	LastEpoch() *Epoch
}

func epochFromCapturer(c capturerWithEpoch) *Epoch { return c.LastEpoch() }

// --- transaction-bound state-store adapters --------------------------------
//
// The capturers call VMStateStore / K8sStateStore with a sourceID only; these
// adapters bind the open transaction + tenant so the capturer's state and epoch
// writes commit atomically with the rest of the pass.

type txVMState struct {
	store    store
	tx       repository.DBTX
	tenantID string
}

func (a *txVMState) LoadVMState(ctx context.Context, sourceID string) (VMState, error) {
	return a.store.GetVMState(ctx, a.tx, a.tenantID, sourceID)
}

func (a *txVMState) SaveEpoch(ctx context.Context, in SaveEpochInput) (Epoch, error) {
	e := Epoch{
		TenantID:     in.TenantID,
		SourceID:     in.SourceID,
		StreamID:     in.StreamID,
		Epoch:        in.Epoch,
		EpochKind:    in.EpochKind,
		FromSeq:      in.FromSeq,
		ToSeq:        in.ToSeq,
		FrameCount:   in.FrameCount,
		ChangedUnits: in.ChangedUnits,
		TotalUnits:   in.TotalUnits,
		PayloadBytes: in.PayloadBytes,
		ContentHash:  in.ContentHash,
		SourceMarker: in.SourceMarker,
	}
	if err := a.store.InsertEpoch(ctx, a.tx, &e); err != nil {
		return Epoch{}, err
	}
	if err := a.store.UpsertVMState(ctx, a.tx, VMState{
		TenantID:       in.TenantID,
		SourceID:       in.SourceID,
		BlockSizeBytes: in.BlockSizeBytes,
		ImageBytes:     in.ImageBytes,
		BlockCount:     len(in.BlockHashes),
		Epoch:          in.Epoch,
		BlockHashes:    in.BlockHashes,
	}); err != nil {
		return Epoch{}, err
	}
	return e, nil
}

type txK8sState struct {
	store    store
	tx       repository.DBTX
	tenantID string
}

func (a *txK8sState) LoadK8sState(ctx context.Context, sourceID string) (*K8sManifestSet, int, error) {
	latest, err := a.store.LatestEpoch(ctx, a.tx, a.tenantID, sourceID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, 0, nil
		}
		return nil, 0, err
	}
	// Rebuild the prior set from the persisted per-resource summary so the next
	// pass's diff is at resource granularity (added/removed/modified), not just
	// a whole-set hash compare. The summary carries (key, hash) for every prior
	// resource, which is exactly what DiffManifestSets needs.
	prior := ManifestSetFromHeaders(latest.SetSummary, latest.ContentHash)
	return prior, latest.Epoch, nil
}

func (a *txK8sState) SaveK8sEpoch(ctx context.Context, in SaveK8sEpochInput) (Epoch, error) {
	e := Epoch{
		TenantID:     in.TenantID,
		SourceID:     in.SourceID,
		StreamID:     in.StreamID,
		Epoch:        in.Epoch,
		EpochKind:    in.EpochKind,
		FromSeq:      in.FromSeq,
		ToSeq:        in.ToSeq,
		FrameCount:   in.FrameCount,
		ChangedUnits: in.ChangedUnits,
		TotalUnits:   in.TotalUnits,
		PayloadBytes: in.PayloadBytes,
		ContentHash:  in.ContentHash,
		SourceMarker: in.SourceMarker,
		SetSummary:   in.Set.Headers(),
	}
	if err := a.store.InsertEpoch(ctx, a.tx, &e); err != nil {
		return Epoch{}, err
	}
	return e, nil
}
