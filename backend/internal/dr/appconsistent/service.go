package appconsistent

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
)

// userIDFromContext returns the authenticated user id from the request context,
// or uuid.Nil when none is set (the barrier records requested_by as NULL).
func userIDFromContext(ctx context.Context) uuid.UUID {
	u := auth.UserFromContext(ctx)
	if u == nil || u.ID == "" {
		return uuid.Nil
	}
	id, err := uuid.Parse(u.ID)
	if err != nil {
		return uuid.Nil
	}
	return id
}

// ReadRunner runs a function inside a tenant-scoped read transaction (RLS set)
// for the listing endpoint. PGXReadRunner adapts a pgx pool.
type ReadRunner interface {
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// PGXReadRunner adapts a pgx pool to ReadRunner.
type PGXReadRunner struct {
	Pool *pgxpool.Pool
}

// RunReadWithTenant runs fn in a tenant-scoped read transaction.
func (r PGXReadRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return fmt.Errorf("appconsistent: nil read pool")
	}
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error {
		return fn(tx)
	})
}

// ReadStore is the read surface for the listing endpoint.
type ReadStore interface {
	ListBarriersByGroup(ctx context.Context, db repository.DBTX, tenantID, groupID string) ([]*Barrier, error)
}

// Service is the application-consistent-point façade the router calls. It builds
// the requested QuiesceProvider, drives the Coordinator, and serves the barrier
// history. It implements API.
type Service struct {
	coord  *Coordinator
	read   ReadRunner
	store  ReadStore
	logger zerolog.Logger
	// providerDefaultTimeout bounds per-provider commands/requests when the
	// request omits an explicit timeout.
	providerDefaultTimeout time.Duration
}

// ServiceConfig wires a Service.
type ServiceConfig struct {
	// Coordinator runs the quiesce/seal/thaw protocol. Required.
	Coordinator *Coordinator
	// Read runs the listing transaction with the tenant RLS context. Required.
	Read ReadRunner
	// Store reads barrier rows. Required.
	Store ReadStore
	// Logger for the handler.
	Logger zerolog.Logger
	// ProviderDefaultTimeout bounds provider commands/requests when the request
	// omits one; defaults to 30s.
	ProviderDefaultTimeout time.Duration
}

// NewService constructs a Service.
func NewService(cfg ServiceConfig) (*Service, error) {
	if cfg.Coordinator == nil {
		return nil, fmt.Errorf("%w: coordinator is required", ErrNotConfigured)
	}
	if cfg.Read == nil {
		return nil, fmt.Errorf("%w: read runner is required", ErrNotConfigured)
	}
	if cfg.Store == nil {
		return nil, fmt.Errorf("%w: read store is required", ErrNotConfigured)
	}
	if cfg.ProviderDefaultTimeout <= 0 {
		cfg.ProviderDefaultTimeout = 30 * time.Second
	}
	return &Service{
		coord:                  cfg.Coordinator,
		read:                   cfg.Read,
		store:                  cfg.Store,
		logger:                 cfg.Logger,
		providerDefaultTimeout: cfg.ProviderDefaultTimeout,
	}, nil
}

// TriggerAppConsistentPoint builds the requested quiesce provider and drives the
// Coordinator. It implements API.
func (s *Service) TriggerAppConsistentPoint(ctx context.Context, tenantID, groupID uuid.UUID, in TriggerRequest) (*Barrier, error) {
	provider, err := s.buildProvider(in)
	if err != nil {
		return nil, err
	}

	var requestedBy *uuid.UUID
	// RequestedBy is best-effort from the auth context; the router does not
	// require a user id, so a nil pointer is acceptable.
	if uid := userIDFromContext(ctx); uid != uuid.Nil {
		requestedBy = &uid
	}

	trigger := TriggerInput{Provider: provider, RequestedBy: requestedBy}
	if in.RetentionUntil != nil {
		trigger.RetentionUntil = *in.RetentionUntil
	}
	return s.coord.Trigger(ctx, tenantID, groupID, trigger)
}

// buildProvider constructs the QuiesceProvider from the request. An empty
// provider string means a crash-consistent point (no quiesce), so it returns a
// nil provider with no error.
func (s *Service) buildProvider(in TriggerRequest) (QuiesceProvider, error) {
	switch in.Provider {
	case "", ProviderNone:
		return nil, nil
	case ProviderScript:
		if in.Script == nil {
			return nil, fmt.Errorf("%w: script provider requires a script configuration", ErrInvalidInput)
		}
		if in.Script.FreezeCmd == "" || in.Script.ThawCmd == "" {
			return nil, fmt.Errorf("%w: script provider requires freeze_cmd and thaw_cmd", ErrInvalidInput)
		}
		return &ScriptQuiesceProvider{
			FreezeCmd: in.Script.FreezeCmd,
			ThawCmd:   in.Script.ThawCmd,
			Shell:     in.Script.Shell,
			Timeout:   s.providerTimeout(in.Script.TimeoutSec),
		}, nil
	case ProviderHTTP:
		if in.HTTP == nil || in.HTTP.BaseURL == "" {
			return nil, fmt.Errorf("%w: http provider requires base_url", ErrInvalidInput)
		}
		return &HTTPQuiesceProvider{
			BaseURL:   in.HTTP.BaseURL,
			AuthToken: in.HTTP.AuthToken,
			Timeout:   s.providerTimeout(in.HTTP.TimeoutSec),
		}, nil
	default:
		return nil, fmt.Errorf("%w: unknown provider %q", ErrInvalidInput, in.Provider)
	}
}

func (s *Service) providerTimeout(sec int) time.Duration {
	if sec > 0 {
		return time.Duration(sec) * time.Second
	}
	return s.providerDefaultTimeout
}

// ListConsistencyBarriers returns a group's barrier history. It implements API.
func (s *Service) ListConsistencyBarriers(ctx context.Context, tenantID, groupID uuid.UUID) ([]*Barrier, error) {
	var barriers []*Barrier
	err := s.read.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var err error
		barriers, err = s.store.ListBarriersByGroup(ctx, db, tenantID.String(), groupID.String())
		return err
	})
	if err != nil {
		return nil, err
	}
	return barriers, nil
}
