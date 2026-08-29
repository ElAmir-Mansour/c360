package appconsistent

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

// Event types emitted to the DR events topic when a barrier completes.
const (
	// EventTypeBarrierSealed is emitted when an application-consistent point was
	// sealed at a barrier.
	EventTypeBarrierSealed = "datastream.dr.appconsistent.barrier.sealed"
	// EventTypeBarrierFailed is emitted when the protocol failed (quiesce or
	// capture) and no application-consistent point was produced.
	EventTypeBarrierFailed = "datastream.dr.appconsistent.barrier.failed"

	eventSource = "clario-dr-service/appconsistent"

	// drEventsTopic is the DR lifecycle topic. The integration phase may pass
	// events.Topics.DREvents instead; this literal keeps the package
	// self-contained (the topic string already exists platform-wide).
	drEventsTopic = "datastream.dr.events"
)

// RecoveryPointSealer seals a consistency-wide recovery point for a group and
// returns the immutable point. *service.Service satisfies this through its
// SealRecoveryPoint method; the integration phase wires the real service via a
// one-field adapter. The Coordinator calls this only after a successful quiesce so
// the sealed point is application-consistent.
type RecoveryPointSealer interface {
	SealRecoveryPoint(ctx context.Context, tenantID, groupID uuid.UUID, in SealInput) (*model.RecoveryPoint, error)
}

// SealInput mirrors the DR service SealRecoveryPointInput so this package does
// not import the shared service. The integration adapter translates between the
// two (a one-field copy).
type SealInput struct {
	// RetentionUntil overrides the WORM default retain-until when set.
	RetentionUntil time.Time
}

// LSNSource resolves the current stream/journal LSN for crash-consistent points.
// Application-consistent points use StreamFencer instead; reading the already
// applied LSN is not enough to prove a quiesced source has drained.
type LSNSource interface {
	CurrentLSN(ctx context.Context, tenantID, groupID uuid.UUID) (string, error)
}

// StreamFence is the source-side marker a StreamFencer has drained to. MarkerLSN
// is persisted on the barrier and must correspond to bytes already applied by
// every consistency-group member before the coordinator seals the recovery point.
type StreamFence struct {
	MarkerLSN string
	Detail    string
}

// StreamFencer places or derives a source-side consistency marker after a
// successful quiesce, then blocks until every member stream has applied through
// that marker. Implementations may use a DataStream MARKER frame or a source log
// cursor such as a PostgreSQL LSN, but they must not return success until the
// control plane's applied-frame store is caught up to the marker.
type StreamFencer interface {
	Fence(ctx context.Context, tenantID, groupID uuid.UUID, quiesce QuiesceResult) (StreamFence, error)
}

// TenantRunner runs a function inside a tenant-scoped read-write transaction
// (RLS set). PGXRunner adapts a pgx pool; tests supply an in-memory fake.
type TenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// PGXRunner adapts a pgx pool to TenantRunner using the shared tenant-context
// helper (SET LOCAL app.current_tenant_id so RLS applies).
type PGXRunner struct {
	Pool *pgxpool.Pool
}

// RunWithTenant runs fn in a tenant-scoped read-write transaction.
func (r PGXRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return fmt.Errorf("appconsistent: nil transaction pool")
	}
	return database.RunWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error {
		return fn(tx)
	})
}

// BarrierStore persists barrier records. *Store satisfies it.
type BarrierStore interface {
	CreateBarrier(ctx context.Context, db repository.DBTX, b *Barrier) error
}

// EventStager stages a DR lifecycle event in the caller's transaction.
// OutboxStager is the production implementation; tests may supply a recorder.
type EventStager interface {
	Stage(ctx context.Context, db repository.DBTX, eventType, tenantID string, data map[string]any) error
}

// OutboxStager writes app-consistent events to the transactional outbox on the
// DR events topic.
type OutboxStager struct{}

// Stage builds a CloudEvent and writes it to the outbox in the caller's tx.
func (OutboxStager) Stage(ctx context.Context, db repository.DBTX, eventType, tenantID string, data map[string]any) error {
	event, err := events.NewEvent(eventType, eventSource, tenantID, data)
	if err != nil {
		return fmt.Errorf("building %s event: %w", eventType, err)
	}
	return outbox.Write(ctx, db, drEventsTopic, event)
}

// Coordinator runs the application-consistent recovery-point protocol:
//
//	quiesce -> fence/drain streams to marker -> seal recovery point -> ALWAYS thaw (defer)
//	        -> persist barrier (+ outbox event) atomically
//
// A successful run leaves an application-consistent point; a quiesce failure
// leaves no point and does NOT thaw (a failed quiesce never froze the workload);
// a capture failure still thaws (defer) and records the barrier as failed.
type Coordinator struct {
	tx      TenantRunner
	store   BarrierStore
	sealer  RecoveryPointSealer
	lsn     LSNSource
	fencer  StreamFencer
	stager  EventStager
	logger  zerolog.Logger
	now     func() time.Time
	quiesce time.Duration
	fence   time.Duration
	thaw    time.Duration
}

// Config wires a Coordinator.
type Config struct {
	// TX runs the persistence transaction with the tenant RLS context.
	TX TenantRunner
	// Store persists barrier rows.
	Store BarrierStore
	// Sealer seals the recovery point after a successful quiesce.
	Sealer RecoveryPointSealer
	// LSN resolves the current barrier LSN; optional (falls back to a synthetic
	// marker derived from the seal time) and used only for crash-consistent
	// points.
	LSN LSNSource
	// Fencer places/derives a source-side marker and waits for stream drain before
	// application-consistent sealing. Required at runtime for ProviderScript and
	// ProviderHTTP requests; when absent, the coordinator records a failed
	// crash-level barrier instead of mislabeling a point as application-consistent.
	Fencer StreamFencer
	// Stager emits the lifecycle event; optional (defaults to the outbox).
	Stager EventStager
	// Logger for non-fatal warnings (e.g. a thaw failure after a sealed point).
	Logger zerolog.Logger
	// Now overrides the clock for deterministic tests.
	Now func() time.Time
	// QuiesceTimeout bounds the quiesce call; defaults to 60s.
	QuiesceTimeout time.Duration
	// FenceTimeout bounds marker placement + stream drain; defaults to 60s.
	FenceTimeout time.Duration
	// ThawTimeout bounds the thaw call; defaults to 60s.
	ThawTimeout time.Duration
}

// NewCoordinator constructs a Coordinator. TX, Store and Sealer are required.
func NewCoordinator(cfg Config) (*Coordinator, error) {
	if cfg.TX == nil {
		return nil, fmt.Errorf("%w: tenant runner is required", ErrNotConfigured)
	}
	if cfg.Store == nil {
		return nil, fmt.Errorf("%w: barrier store is required", ErrNotConfigured)
	}
	if cfg.Sealer == nil {
		return nil, fmt.Errorf("%w: recovery-point sealer is required", ErrNotConfigured)
	}
	if cfg.Stager == nil {
		cfg.Stager = OutboxStager{}
	}
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	if cfg.QuiesceTimeout <= 0 {
		cfg.QuiesceTimeout = 60 * time.Second
	}
	if cfg.FenceTimeout <= 0 {
		cfg.FenceTimeout = 60 * time.Second
	}
	if cfg.ThawTimeout <= 0 {
		cfg.ThawTimeout = 60 * time.Second
	}
	return &Coordinator{
		tx:      cfg.TX,
		store:   cfg.Store,
		sealer:  cfg.Sealer,
		lsn:     cfg.LSN,
		fencer:  cfg.Fencer,
		stager:  cfg.Stager,
		logger:  cfg.Logger,
		now:     cfg.Now,
		quiesce: cfg.QuiesceTimeout,
		fence:   cfg.FenceTimeout,
		thaw:    cfg.ThawTimeout,
	}, nil
}

// TriggerInput requests an application-consistent point for a group using a
// quiesce provider.
type TriggerInput struct {
	// Provider freezes/thaws the workload. Required for an application-consistent
	// point; a nil provider produces a crash-consistent point (no quiesce).
	Provider QuiesceProvider
	// RequestedBy is the operator (optional) recorded on the barrier.
	RequestedBy *uuid.UUID
	// RetentionUntil overrides the WORM default retain-until when set.
	RetentionUntil time.Time
}

// Trigger runs the protocol and returns the durable barrier. The error is
// non-nil only when the application-consistent point could NOT be produced
// (quiesce failed, capture failed, or thaw failed) or persistence failed; in the
// quiesce/capture/thaw failure cases the returned *Barrier is still populated and
// persisted so the caller can surface the recorded outcome.
func (c *Coordinator) Trigger(ctx context.Context, tenantID, groupID uuid.UUID, in TriggerInput) (*Barrier, error) {
	if c == nil {
		return nil, ErrNotConfigured
	}
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalidInput)
	}
	if groupID == uuid.Nil {
		return nil, fmt.Errorf("%w: group id is required", ErrInvalidInput)
	}

	barrier := &Barrier{
		TenantID:         tenantID.String(),
		GroupID:          groupID.String(),
		ConsistencyLevel: ConsistencyCrash,
		Provider:         ProviderNone,
	}
	if in.RequestedBy != nil {
		s := in.RequestedBy.String()
		barrier.RequestedBy = &s
	}

	if in.Provider == nil {
		// No provider: a bare crash-consistent point. No quiesce, no thaw.
		barrier.Provider = ProviderNone
		c.captureInto(ctx, tenantID, groupID, in, barrier, ConsistencyCrash)
		return c.persistResult(ctx, tenantID, groupID, barrier)
	}

	barrier.Provider = in.Provider.Kind()
	if c.fencer == nil {
		barrier.Success = false
		barrier.ConsistencyLevel = ConsistencyCrash
		barrier.Error = fmt.Sprintf("%s: stream fencer is required", ErrFenceFailed)
		barrier.Detail = "application-consistent point not attempted because stream fencing is not configured"
		return c.persistResult(ctx, tenantID, groupID, barrier)
	}

	// Phase 1: quiesce. On failure the workload was never frozen, so we do NOT
	// thaw; record a failed, crash-level barrier and return.
	qctx, qcancel := context.WithTimeout(ctx, c.quiesce)
	barrier.QuiesceStartedAt = c.timePtr()
	qres, qerr := in.Provider.Quiesce(qctx)
	qcancel()
	barrier.QuiesceFinishedAt = c.timePtr()
	if qerr != nil {
		barrier.Quiesced = false
		barrier.Success = false
		barrier.ConsistencyLevel = ConsistencyCrash
		barrier.Detail = truncate(qres.Output)
		barrier.Error = qerr.Error()
		return c.persistResult(ctx, tenantID, groupID, barrier)
	}
	barrier.Quiesced = true

	// The workload is now frozen. ALWAYS thaw — even if sealing below fails or
	// panics — via defer, recording the outcome on the barrier exactly once. The
	// deferred thaw runs before persistResult (called after this function body
	// completes, below the defer), so the persisted barrier reflects the thaw.
	thawed := false
	thaw := func() {
		if thawed {
			return
		}
		thawed = true
		tctx, tcancel := context.WithTimeout(context.WithoutCancel(ctx), c.thaw)
		defer tcancel()
		barrier.ThawStartedAt = c.timePtr()
		_, terr := in.Provider.Thaw(tctx, qres)
		barrier.ThawFinishedAt = c.timePtr()
		if terr == nil {
			barrier.Thawed = true
			return
		}
		barrier.Thawed = false
		// A thaw failure cannot un-seal an already-sealed point, but the workload
		// may be stuck frozen — surface it. Mark the overall run unsuccessful and
		// append the thaw error so an operator intervenes.
		barrier.Success = false
		barrier.Error = appendErr(barrier.Error, terr.Error())
		c.logger.Error().Err(terr).
			Str("tenant_id", tenantID.String()).
			Str("group_id", groupID.String()).
			Msg("appconsistent: thaw failed — workload may remain frozen")
	}
	// Guarantee thaw on a panic in the seal path; the normal path calls thaw()
	// explicitly below so persistResult observes the thaw outcome.
	defer thaw()

	// Phase 2: place/derive the source marker and wait for every member stream
	// to apply through it. Without this drain, a lagging replication stream could
	// seal bytes from before the quiesced flush and falsely claim application
	// consistency.
	fctx, fcancel := context.WithTimeout(ctx, c.fence)
	fence, ferr := c.fencer.Fence(fctx, tenantID, groupID, qres)
	fcancel()
	if ferr != nil {
		barrier.Success = false
		barrier.ConsistencyLevel = ConsistencyCrash
		barrier.Error = fmt.Sprintf("%s: %v", ErrFenceFailed, ferr)
		barrier.Detail = truncate(qres.Output)
		if strings.TrimSpace(fence.MarkerLSN) != "" {
			barrier.BarrierLSN = strings.TrimSpace(fence.MarkerLSN)
		}
		thaw()
		return c.persistResult(ctx, tenantID, groupID, barrier)
	}
	if strings.TrimSpace(fence.MarkerLSN) == "" {
		barrier.Success = false
		barrier.ConsistencyLevel = ConsistencyCrash
		barrier.Error = fmt.Sprintf("%s: empty marker LSN", ErrFenceFailed)
		barrier.Detail = truncate(qres.Output)
		thaw()
		return c.persistResult(ctx, tenantID, groupID, barrier)
	}
	barrier.BarrierLSN = strings.TrimSpace(fence.MarkerLSN)

	// Phase 3: seal the application-consistent recovery point after the stream
	// fence proves the quiesced marker is durable in the applied-frame store.
	point, serr := c.sealer.SealRecoveryPoint(ctx, tenantID, groupID, SealInput{RetentionUntil: in.RetentionUntil})
	if serr != nil {
		// Quiesce happened, so the *attempted* level is application, but no point
		// was produced — the barrier is failed and carries no recovery_point_id.
		barrier.Success = false
		barrier.ConsistencyLevel = ConsistencyApplication
		barrier.Error = serr.Error()
		barrier.Detail = truncate(qres.Output)
		thaw()
		return c.persistResult(ctx, tenantID, groupID, barrier)
	}

	barrier.RecoveryPointID = strPtr(point.ID)
	barrier.ConsistencyLevel = ConsistencyApplication
	barrier.Success = true
	barrier.Detail = fmt.Sprintf("application-consistent point %s sealed at LSN %q (rpo=%ds)",
		point.ID, barrier.BarrierLSN, point.RPOSeconds)
	if strings.TrimSpace(fence.Detail) != "" {
		barrier.Detail += "; " + truncate(fence.Detail)
	}

	thaw()
	return c.persistResult(ctx, tenantID, groupID, barrier)
}

// captureInto seals a recovery point WITHOUT a quiesce (crash-consistent) and
// records the outcome on barrier. Used when no provider is supplied. Errors are
// recorded on the barrier rather than returned so the persist path is uniform.
func (c *Coordinator) captureInto(ctx context.Context, tenantID, groupID uuid.UUID, in TriggerInput, barrier *Barrier, level string) {
	barrier.BarrierLSN = c.resolveLSN(ctx, tenantID, groupID)
	point, err := c.sealer.SealRecoveryPoint(ctx, tenantID, groupID, SealInput{RetentionUntil: in.RetentionUntil})
	if err != nil {
		barrier.Success = false
		barrier.ConsistencyLevel = level
		barrier.Error = err.Error()
		return
	}
	barrier.RecoveryPointID = strPtr(point.ID)
	barrier.ConsistencyLevel = level
	barrier.Success = true
	barrier.Detail = fmt.Sprintf("%s-consistent point %s sealed at LSN %q (rpo=%ds)",
		level, point.ID, barrier.BarrierLSN, point.RPOSeconds)
}

// persistResult writes the barrier and its lifecycle event in one tenant-scoped
// transaction, then returns the barrier with an error reflecting the recorded
// outcome (so a failed barrier surfaces as an error to the caller while still
// being durably recorded).
func (c *Coordinator) persistResult(ctx context.Context, tenantID, groupID uuid.UUID, barrier *Barrier) (*Barrier, error) {
	eventType := EventTypeBarrierFailed
	if barrier.Success {
		eventType = EventTypeBarrierSealed
	}

	persistErr := c.tx.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		if err := c.store.CreateBarrier(ctx, db, barrier); err != nil {
			return err
		}
		data := map[string]any{
			"group_id":          groupID.String(),
			"barrier_id":        barrier.ID,
			"consistency_level": barrier.ConsistencyLevel,
			"provider":          barrier.Provider,
			"barrier_lsn":       barrier.BarrierLSN,
			"success":           barrier.Success,
			"quiesced":          barrier.Quiesced,
			"thawed":            barrier.Thawed,
		}
		if barrier.RecoveryPointID != nil {
			data["recovery_point_id"] = *barrier.RecoveryPointID
		}
		if barrier.Error != "" {
			data["error"] = barrier.Error
		}
		return c.stager.Stage(ctx, db, eventType, tenantID.String(), data)
	})
	if persistErr != nil {
		return nil, fmt.Errorf("persisting consistency barrier for group %s: %w", groupID, persistErr)
	}

	if !barrier.Success {
		return barrier, c.recordedError(barrier)
	}
	return barrier, nil
}

// recordedError maps a recorded (durably persisted) failed barrier to the
// sentinel that best describes the failing phase.
func (c *Coordinator) recordedError(b *Barrier) error {
	switch {
	case strings.Contains(b.Error, ErrFenceFailed.Error()):
		return fmt.Errorf("%w: %s", ErrFenceFailed, strings.TrimSpace(b.Error))
	case b.Provider != ProviderNone && !b.Quiesced:
		return fmt.Errorf("%w: %s", ErrQuiesceFailed, b.Error)
	case b.RecoveryPointID == nil:
		return fmt.Errorf("%w: %s", ErrCaptureFailed, b.Error)
	case !b.Thawed:
		return fmt.Errorf("%w: %s", ErrThawFailed, b.Error)
	default:
		return fmt.Errorf("appconsistent: barrier failed: %s", b.Error)
	}
}

// resolveLSN reads the current barrier LSN from the LSNSource, falling back to a
// synthetic, deterministic marker when no source is wired or the lookup fails
// (the barrier is still useful — it pins the seal time).
func (c *Coordinator) resolveLSN(ctx context.Context, tenantID, groupID uuid.UUID) string {
	if c.lsn != nil {
		if lsn, err := c.lsn.CurrentLSN(ctx, tenantID, groupID); err == nil && strings.TrimSpace(lsn) != "" {
			return lsn
		} else if err != nil {
			c.logger.Warn().Err(err).
				Str("group_id", groupID.String()).
				Msg("appconsistent: LSN source failed; using synthetic barrier marker")
		}
	}
	return fmt.Sprintf("barrier:%s@%d", groupID.String(), c.now().Unix())
}

func (c *Coordinator) timePtr() *time.Time {
	t := c.now()
	return &t
}

func strPtr(s string) *string { return &s }

// appendErr joins two error strings without losing either.
func appendErr(existing, add string) string {
	if existing == "" {
		return add
	}
	if add == "" {
		return existing
	}
	return existing + "; " + add
}

// truncate bounds captured provider output stored in the barrier detail so a
// chatty script cannot bloat the row.
func truncate(s string) string {
	const max = 4000
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "…[truncated]"
}
