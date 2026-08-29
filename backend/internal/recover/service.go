package recover

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// ErrUnknownSubSolution is returned for a sub-solution slug not in the registry.
var ErrUnknownSubSolution = errors.New("recover: unknown sub-solution")

// Config wires a Service.
type Config struct {
	// Runner runs tenant-scoped transactions for activation state.
	Runner TenantRunner
	// Store persists per-tenant sub-solution activation.
	Store ActivationStore
	// Entitlements resolves per-tenant licensing state via the existing engine.
	Entitlements EntitlementResolver
	// Logger is the structured logger; required.
	Logger zerolog.Logger
	// Now is injectable for deterministic tests; defaults to time.Now().UTC().
	Now func() time.Time
}

// Service is the Recover productization service: it composes the capability
// registry, the existing entitlement engine, and per-tenant activation state
// into the product view, and persists activation changes. It does not own or
// reimplement any dr/* recovery logic.
type Service struct {
	runner       TenantRunner
	store        ActivationStore
	entitlements EntitlementResolver
	logger       zerolog.Logger
	now          func() time.Time
}

// NewService validates the config and constructs the service.
func NewService(cfg Config) (*Service, error) {
	if cfg.Runner == nil {
		return nil, errors.New("recover service: runner is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("recover service: store is required")
	}
	if cfg.Entitlements == nil {
		return nil, errors.New("recover service: entitlement resolver is required")
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		runner:       cfg.Runner,
		store:        cfg.Store,
		entitlements: cfg.Entitlements,
		logger:       cfg.Logger.With().Str("service", "recover").Logger(),
		now:          now,
	}, nil
}

// GetProducts returns the Recover product view for a tenant: the product
// identity, each sub-solution with its composed dr/* capabilities, and the live
// entitlement state resolved per sub-solution from the existing licensing
// engine, merged with persisted activation state. authorization is the caller's
// "Bearer <token>" header, forwarded to the licensing engine so it derives the
// same tenant from the same validated token.
//
// Entitlement is resolved per key against the real engine — never a hardcoded
// "all enabled". An inability to reach the engine fails closed
// (ErrEntitlementUnavailable) rather than guessing.
func (s *Service) GetProducts(ctx context.Context, tenantID uuid.UUID, authorization string) (*ProductView, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("recover: tenant id is required")
	}

	activations, err := s.loadActivations(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	subs := Registry()
	for i := range subs {
		ss := &subs[i]
		active, reason, err := s.entitlements.Resolve(ctx, tenantID.String(), authorization, ss.EntitlementKey)
		if err != nil {
			return nil, err
		}
		ss.Entitlement = &EntitlementState{
			Key:       ss.EntitlementKey,
			Active:    active,
			Activated: activations[ss.ID].Activated,
			Reason:    reason,
		}
	}

	s.logger.Debug().
		Str("tenant_id", tenantID.String()).
		Int("sub_solutions", len(subs)).
		Msg("resolved recover product view")

	return &ProductView{
		Product:      Product,
		Label:        ProductLabel,
		SubSolutions: subs,
	}, nil
}

// SetActivation persists whether a tenant has activated one sub-solution. It
// validates the slug against the registry and writes inside a tenant-scoped
// transaction (RLS-isolated). It is the persistence seam onboarding (Prompt 9)
// uses; activating a sub-solution here does NOT grant licensing entitlement —
// that remains the licensing engine's responsibility.
func (s *Service) SetActivation(ctx context.Context, tenantID uuid.UUID, subSolution string, activated bool) (*Activation, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("recover: tenant id is required")
	}
	if _, ok := entitlementKeyForSubSolution(subSolution); !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownSubSolution, subSolution)
	}

	now := s.now()
	err := s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		return s.store.SetActivation(ctx, db, tenantID, subSolution, activated, now)
	})
	if err != nil {
		return nil, err
	}

	s.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("sub_solution", subSolution).
		Bool("activated", activated).
		Msg("recover sub-solution activation updated")

	return &Activation{SubSolution: subSolution, Activated: activated, UpdatedAt: now}, nil
}

// loadActivations reads the tenant's activation rows in one read transaction.
func (s *Service) loadActivations(ctx context.Context, tenantID uuid.UUID) (map[string]Activation, error) {
	var out map[string]Activation
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var err error
		out, err = s.store.ListActivations(ctx, db, tenantID)
		return err
	})
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = map[string]Activation{}
	}
	return out, nil
}
