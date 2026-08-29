package instant

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const eventSource = "clario-dr-service/instant"

// Lifecycle event types emitted on datastream.dr.events. They follow the
// com.clario360.datastream.dr.<entity>.<verb> convention used across DR.
const (
	EventTypeSessionStarted   = "com.clario360.datastream.dr.instant.started"
	EventTypeSessionReady     = "com.clario360.datastream.dr.instant.ready"
	EventTypeSessionFinalized = "com.clario360.datastream.dr.instant.finalized"
	EventTypeSessionFailed    = "com.clario360.datastream.dr.instant.failed"
)

// drEventsTopic is the existing lifecycle topic (events.Topics.DREvents); kept
// as a literal-backed reference so this package does not edit shared files.
var drEventsTopic = events.Topics.DREvents

// TenantRunner runs read/write functions against the tenant-scoped DB so RLS
// sees app.current_tenant_id. The request path (start / get / begin-finalize)
// uses it; the DR service's tenant runner satisfies it.
type TenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID string, fn func(repository.DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID string, fn func(repository.DBTX) error) error
}

// SystemRunner runs functions on the cross-tenant system path (RLS bypassed),
// as the leader-singleton hydration loop does everywhere in dr_db. The DR
// service's PGXSystemRunner satisfies it.
type SystemRunner interface {
	RunSystemTx(ctx context.Context, fn func(repository.DBTX) error) error
	RunSystemRead(ctx context.Context, fn func(repository.DBTX) error) error
}

// BaseReaderFactory resolves the immutable base reader for a recovery point.
// The integration wiring satisfies it with an adapter over the WORM/DEK
// recovery-point store (service.Service.ReadSealedChunk), so base reads are the
// real sealed-chunk path. It is a factory because the base geometry (chunk
// count / size) is per recovery point.
type BaseReaderFactory interface {
	BaseReader(ctx context.Context, tenantID, recoveryPointID uuid.UUID) (BaseReader, error)
}

// FinalizeSinkFactory produces the sink Finalize writes the standalone full copy
// to (e.g. a fresh WORM-sealed object). It is a factory so each session's copy
// lands in its own location. The integration wiring supplies a WORM sink; tests
// supply an in-memory one.
type FinalizeSinkFactory interface {
	FinalizeSink(ctx context.Context, tenantID, sessionID uuid.UUID) (FinalizeSink, error)
}

// sessionStore is the persistence surface the service drives (satisfied by
// *Store; an interface so the service is unit-testable without a database).
type sessionStore interface {
	overlayStore
	hydratorStore
	CreateSession(ctx context.Context, db repository.DBTX, sess *Session) error
	GetSession(ctx context.Context, db repository.DBTX, tenantID, id uuid.UUID) (*Session, error)
	TransitionToReady(ctx context.Context, db repository.DBTX, id uuid.UUID, hydrated int) (bool, error)
	TransitionToFinalizing(ctx context.Context, db repository.DBTX, id uuid.UUID) (bool, error)
	TransitionToFinalized(ctx context.Context, db repository.DBTX, id uuid.UUID, location string) (bool, error)
	FailSession(ctx context.Context, db repository.DBTX, id uuid.UUID, reason string) (bool, error)
	ClaimActiveSessions(ctx context.Context, db repository.DBTX, limit int) ([]*Session, error)
	ListOverlayChunks(ctx context.Context, db repository.DBTX, sessionID uuid.UUID) ([]OverlayChunk, error)
}

// Deps wires the instant-recovery service.
type Deps struct {
	Store       sessionStore
	Runner      TenantRunner
	System      SystemRunner
	BaseReaders BaseReaderFactory
	Sinks       FinalizeSinkFactory
	Hydrator    *Hydrator
	Metrics     *Metrics
	// OverlayLocation is copied onto each session for operator visibility.
	OverlayLocation string
	Logger          zerolog.Logger
	Now             func() time.Time
}

// Service is the instant-recovery control surface. It starts COW sessions over a
// recovery point, reports hydration progress, finalizes a session into a
// standalone full copy, and serves the recovered workload's chunk reads/writes
// through the overlay. Lifecycle transitions are written transactionally with
// their datastream.dr.events outbox event (state + event atomicity).
type Service struct {
	store           sessionStore
	runner          TenantRunner
	system          SystemRunner
	bases           BaseReaderFactory
	sinks           FinalizeSinkFactory
	hydrator        *Hydrator
	metrics         *Metrics
	overlayLocation string
	logger          zerolog.Logger
	now             func() time.Time
}

// NewService constructs the instant-recovery service.
func NewService(d Deps) (*Service, error) {
	if d.Store == nil {
		return nil, errors.New("instant service: store is required")
	}
	if d.Runner == nil {
		return nil, errors.New("instant service: tenant runner is required")
	}
	if d.BaseReaders == nil {
		return nil, errors.New("instant service: base reader factory is required")
	}
	overlayLocation := d.OverlayLocation
	if overlayLocation == "" {
		overlayLocation = "db:dr_instant_overlay_chunk"
	}
	now := d.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		store:           d.Store,
		runner:          d.Runner,
		system:          d.System,
		bases:           d.BaseReaders,
		sinks:           d.Sinks,
		hydrator:        d.Hydrator,
		metrics:         d.Metrics,
		overlayLocation: overlayLocation,
		logger:          d.Logger.With().Str("component", "dr_instant").Logger(),
		now:             now,
	}, nil
}

// StartSession opens an instant-recovery session: it resolves the immutable base
// reader for the recovery point, records a HYDRATING session sized to the base
// geometry, and emits instant.started — all in one tenant transaction so the row
// and its event commit together. The recovered workload can begin reading/writing
// through the overlay immediately (it is instant); the dataset hydrates lazily.
func (s *Service) StartSession(ctx context.Context, tenantID, recoveryPointID uuid.UUID, groupID *uuid.UUID) (*Session, error) {
	base, err := s.bases.BaseReader(ctx, tenantID, recoveryPointID)
	if err != nil {
		return nil, fmt.Errorf("instant: resolving base reader for recovery point %s: %w", recoveryPointID, err)
	}
	count, err := base.ChunkCount(ctx)
	if err != nil {
		return nil, fmt.Errorf("instant: reading base chunk count: %w", err)
	}
	if count <= 0 {
		return nil, fmt.Errorf("recovery point %s: %w", recoveryPointID, ErrNoBaseChunks)
	}
	chunkSize, err := base.ChunkSize(ctx)
	if err != nil {
		return nil, fmt.Errorf("instant: reading base chunk size: %w", err)
	}

	sess := &Session{
		TenantID:        tenantID,
		RecoveryPointID: recoveryPointID,
		GroupID:         groupID,
		State:           StateHydrating,
		ChunksTotal:     count,
		ChunkSize:       chunkSize,
		OverlayLocation: s.overlayLocation,
	}
	err = s.runner.RunWithTenant(ctx, tenantID.String(), func(db repository.DBTX) error {
		if cerr := s.store.CreateSession(ctx, db, sess); cerr != nil {
			return cerr
		}
		return s.emit(ctx, db, EventTypeSessionStarted, sess, map[string]any{
			"session_id":        sess.ID.String(),
			"recovery_point_id": recoveryPointID.String(),
			"chunks_total":      count,
			"chunk_size":        chunkSize,
		})
	})
	if err != nil {
		return nil, err
	}
	s.metrics.IncStarted()
	s.metrics.SetHydrationProgress(sess.ID.String(), sess.PercentComplete())
	s.logger.Info().Str("session_id", sess.ID.String()).
		Str("recovery_point_id", recoveryPointID.String()).
		Int("chunks_total", count).Msg("instant recovery session started")
	return sess, nil
}

// GetProgress returns a session's current state and hydration percentage.
func (s *Service) GetProgress(ctx context.Context, tenantID, sessionID uuid.UUID) (*Progress, error) {
	var sess *Session
	err := s.runner.RunReadWithTenant(ctx, tenantID.String(), func(db repository.DBTX) error {
		var gerr error
		sess, gerr = s.store.GetSession(ctx, db, tenantID, sessionID)
		return gerr
	})
	if err != nil {
		return nil, err
	}
	return &Progress{Session: sess, PercentComplete: sess.PercentComplete()}, nil
}

// ReadChunk serves a recovered workload's read for chunk i: the overlay value if
// written/hydrated, else a read-through of the immutable base. It binds an
// overlay over a read transaction so RLS scopes the overlay lookup to the tenant.
func (s *Service) ReadChunk(ctx context.Context, tenantID, sessionID uuid.UUID, i int) ([]byte, error) {
	base, sess, err := s.loadBaseAndSession(ctx, tenantID, sessionID)
	if err != nil {
		return nil, err
	}
	var out []byte
	err = s.runner.RunReadWithTenant(ctx, tenantID.String(), func(db repository.DBTX) error {
		overlay := NewOverlayStore(s.store, base, db, tenantID, sessionID, sess.ChunksTotal)
		var rerr error
		started := s.now()
		out, rerr = overlay.ReadChunk(ctx, i)
		s.metrics.ObserveReadChunk("chunk", s.now().Sub(started).Seconds())
		return rerr
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// WriteChunk redirects a recovered workload's write for chunk i into the private
// overlay (redirect-on-write); the immutable base recovery point is untouched.
func (s *Service) WriteChunk(ctx context.Context, tenantID, sessionID uuid.UUID, i int, data []byte) error {
	base, sess, err := s.loadBaseAndSession(ctx, tenantID, sessionID)
	if err != nil {
		return err
	}
	err = s.runner.RunWithTenant(ctx, tenantID.String(), func(db repository.DBTX) error {
		overlay := NewOverlayStore(s.store, base, db, tenantID, sessionID, sess.ChunksTotal)
		return overlay.WriteChunk(ctx, i, data)
	})
	if err != nil {
		return err
	}
	s.metrics.IncChunkWritten()
	return nil
}

// BeginFinalize requests finalization of a READY session: it transitions
// READY -> FINALIZING (guarded so a non-READY session is rejected) and returns
// the updated session. The actual standalone-copy assembly runs on the system
// loop (FinalizeSession) so a long copy does not block the request. Calling on a
// not-yet-READY session returns ErrNotReady.
func (s *Service) BeginFinalize(ctx context.Context, tenantID, sessionID uuid.UUID) (*Session, error) {
	var sess *Session
	err := s.runner.RunWithTenant(ctx, tenantID.String(), func(db repository.DBTX) error {
		current, gerr := s.store.GetSession(ctx, db, tenantID, sessionID)
		if gerr != nil {
			return gerr
		}
		if current.State == StateFinalizing || current.State == StateFinalized {
			// Idempotent: already finalizing/finalized.
			sess = current
			return nil
		}
		if current.State != StateReady {
			return fmt.Errorf("session %s is %s: %w", sessionID, current.State, ErrNotReady)
		}
		ok, terr := s.store.TransitionToFinalizing(ctx, db, sessionID)
		if terr != nil {
			return terr
		}
		if !ok {
			// Lost the race; re-read the authoritative state.
			sess, gerr = s.store.GetSession(ctx, db, tenantID, sessionID)
			return gerr
		}
		current.State = StateFinalizing
		sess = current
		return nil
	})
	if err != nil {
		return nil, err
	}
	return sess, nil
}

// HydrateOnce runs one hydration pass for a session on the system path and, when
// hydration completes, transitions HYDRATING -> READY transactionally with the
// instant.ready event. It is invoked by the HydrateLoop and is directly callable
// in tests. It is safe to re-invoke: progress resumes from the overlay.
func (s *Service) HydrateOnce(ctx context.Context, sess *Session) (HydrateResult, error) {
	if s.hydrator == nil {
		return HydrateResult{}, errors.New("instant: hydrator is not configured")
	}
	base, err := s.bases.BaseReader(ctx, sess.TenantID, sess.RecoveryPointID)
	if err != nil {
		return HydrateResult{}, fmt.Errorf("instant: resolving base reader for session %s: %w", sess.ID, err)
	}

	var res HydrateResult
	err = s.system.RunSystemTx(ctx, func(db repository.DBTX) error {
		overlay := NewOverlayStore(s.store, base, db, sess.TenantID, sess.ID, sess.ChunksTotal)
		var herr error
		res, herr = s.hydrator.HydrateSession(ctx, db, overlay, sess.ID)
		if herr != nil {
			return herr
		}
		if res.Complete {
			ok, terr := s.store.TransitionToReady(ctx, db, sess.ID, res.TotalHydrated)
			if terr != nil {
				return terr
			}
			if ok {
				return s.emit(ctx, db, EventTypeSessionReady, sess, map[string]any{
					"session_id":      sess.ID.String(),
					"chunks_hydrated": res.TotalHydrated,
					"chunks_total":    res.Total,
				})
			}
		}
		return nil
	})
	if err != nil {
		return HydrateResult{}, err
	}
	if res.Complete {
		s.metrics.IncReady()
		s.metrics.ObserveTimeToReady(s.now().Sub(sess.StartedAt).Seconds())
		s.logger.Info().Str("session_id", sess.ID.String()).
			Int("chunks", res.Total).Msg("instant recovery session fully hydrated (READY)")
	}
	return res, nil
}

// FinalizeSession completes a FINALIZING session: it assembles the standalone
// full copy through the overlay into the sink, then transitions
// FINALIZING -> FINALIZED transactionally with the instant.finalized event,
// recording where the copy landed. The copy I/O happens OUTSIDE the transaction
// (it may be large); only the terminal flip is transactional, and it is guarded
// so a re-claim does not re-finalize. Invoked by the HydrateLoop for sessions in
// FINALIZING, and directly callable in tests.
func (s *Service) FinalizeSession(ctx context.Context, sess *Session) error {
	if s.sinks == nil {
		return errors.New("instant: finalize sink factory is not configured")
	}
	base, err := s.bases.BaseReader(ctx, sess.TenantID, sess.RecoveryPointID)
	if err != nil {
		return fmt.Errorf("instant: resolving base reader for finalize of session %s: %w", sess.ID, err)
	}
	sink, err := s.sinks.FinalizeSink(ctx, sess.TenantID, sess.ID)
	if err != nil {
		return fmt.Errorf("instant: building finalize sink for session %s: %w", sess.ID, err)
	}

	// Assemble the full copy on the system read path (RLS bypassed, no tenant
	// filter for the loop) reading every chunk through the overlay.
	err = s.system.RunSystemRead(ctx, func(db repository.DBTX) error {
		overlay := NewOverlayStore(s.store, base, db, sess.TenantID, sess.ID, sess.ChunksTotal)
		_, cerr := FinalizeCopy(ctx, overlay, sink)
		return cerr
	})
	if err != nil {
		return err
	}

	location := sink.Location()
	err = s.system.RunSystemTx(ctx, func(db repository.DBTX) error {
		ok, terr := s.store.TransitionToFinalized(ctx, db, sess.ID, location)
		if terr != nil {
			return terr
		}
		if !ok {
			// Already finalized (re-claim); nothing more to do.
			return nil
		}
		return s.emit(ctx, db, EventTypeSessionFinalized, sess, map[string]any{
			"session_id":         sess.ID.String(),
			"finalized_location": location,
			"recovery_point_id":  sess.RecoveryPointID.String(),
		})
	})
	if err != nil {
		return err
	}
	s.metrics.IncFinalized()
	s.metrics.ClearHydrationProgress(sess.ID.String())
	s.logger.Info().Str("session_id", sess.ID.String()).
		Str("location", location).Msg("instant recovery session finalized (standalone copy)")
	return nil
}

// failSession moves a session to FAILED on the system path, transactionally with
// the instant.failed event. Used by the loop when a pass errors.
func (s *Service) failSession(ctx context.Context, sess *Session, cause error) {
	reason := cause.Error()
	werr := s.system.RunSystemTx(ctx, func(db repository.DBTX) error {
		ok, ferr := s.store.FailSession(ctx, db, sess.ID, reason)
		if ferr != nil {
			return ferr
		}
		if !ok {
			return nil
		}
		return s.emit(ctx, db, EventTypeSessionFailed, sess, map[string]any{
			"session_id": sess.ID.String(),
			"error":      reason,
		})
	})
	if werr != nil {
		s.logger.Error().Err(werr).Str("session_id", sess.ID.String()).
			Msg("failed to record instant recovery session failure")
		return
	}
	s.metrics.IncFailed()
	s.logger.Warn().Err(cause).Str("session_id", sess.ID.String()).
		Msg("instant recovery session marked FAILED")
}

// loadBaseAndSession resolves the session (tenant-scoped) and its base reader,
// shared by ReadChunk/WriteChunk.
func (s *Service) loadBaseAndSession(ctx context.Context, tenantID, sessionID uuid.UUID) (BaseReader, *Session, error) {
	var sess *Session
	if err := s.runner.RunReadWithTenant(ctx, tenantID.String(), func(db repository.DBTX) error {
		var gerr error
		sess, gerr = s.store.GetSession(ctx, db, tenantID, sessionID)
		return gerr
	}); err != nil {
		return nil, nil, err
	}
	base, err := s.bases.BaseReader(ctx, tenantID, sess.RecoveryPointID)
	if err != nil {
		return nil, nil, fmt.Errorf("instant: resolving base reader for session %s: %w", sessionID, err)
	}
	return base, sess, nil
}

// emit stages a lifecycle event to the DR events outbox within the caller's
// transaction so state + event commit atomically.
func (s *Service) emit(ctx context.Context, db repository.DBTX, eventType string, sess *Session, data map[string]any) error {
	if _, ok := data["tenant_id"]; !ok {
		data["tenant_id"] = sess.TenantID.String()
	}
	if sess.GroupID != nil {
		if _, ok := data["group_id"]; !ok {
			data["group_id"] = sess.GroupID.String()
		}
	}
	evt, err := events.NewEvent(eventType, eventSource, sess.TenantID.String(), data)
	if err != nil {
		return fmt.Errorf("instant: building %s event: %w", eventType, err)
	}
	if err := outbox.Write(ctx, db, drEventsTopic, evt); err != nil {
		return fmt.Errorf("instant: staging %s event: %w", eventType, err)
	}
	return nil
}
