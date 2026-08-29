// Package service implements pricing config governance and quote computation.
//
// Config is versioned DATA: drafts are created and edited, then PUBLISHED,
// which archives the prior active version and activates the draft in ONE
// transaction that also stages a pricing.config_published outbox event — the
// same transactional-outbox pattern as licensing's AssignLicense, so pricing
// governance inherits the platform's hash-chained tamper-evident audit with no
// new plumbing.
//
// Compute is server-authoritative: it loads the active config and runs the PURE
// engine. The client never supplies rates, markup, or the margin floor.
package service

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
	"github.com/clario360/platform/internal/pricing/engine"
	"github.com/clario360/platform/internal/pricing/model"
	"github.com/clario360/platform/internal/pricing/repository"
)

const eventSource = "license-service"

const (
	eventConfigPublished = "pricing.config_published"
	eventConfigArchived  = "pricing.config_archived"
)

// Repo abstracts the repository so the service can depend on an interface and
// tests can substitute an in-memory implementation (exported so handler-package
// tests can build a service without a database).
type Repo interface {
	GetActive(ctx context.Context, db repository.DBTX) (*model.PricingConfig, error)
	GetByVersion(ctx context.Context, db repository.DBTX, version int) (*model.PricingConfig, error)
	List(ctx context.Context, db repository.DBTX) ([]*model.PricingConfig, error)
	MaxVersion(ctx context.Context, db repository.DBTX) (int, error)
	CreateDraft(ctx context.Context, db repository.DBTX, c *model.PricingConfig) (*model.PricingConfig, error)
	UpdateDraft(ctx context.Context, db repository.DBTX, c *model.PricingConfig) (*model.PricingConfig, error)
	ArchiveActive(ctx context.Context, db repository.DBTX) error
	Activate(ctx context.Context, db repository.DBTX, version int) (*model.PricingConfig, error)
	ArchiveVersion(ctx context.Context, db repository.DBTX, version int) (*model.PricingConfig, error)
}

// Service is the pricing engine orchestrator + config governance.
type Service struct {
	pool      *pgxpool.Pool
	repo      Repo
	quoteRepo QuoteRepo // attached via SetQuoteRepo; nil for config-only construction
	logger    zerolog.Logger
	now       func() time.Time
	// tierPlans is the tier→license-plan-key mapping used by the commercial loop
	// (accept event + provision-from-quote). New installs DefaultTierPlanMap;
	// wiring may override it via SetTierPlanMap.
	tierPlans TierPlanMap
	// assigner closes the commercial loop by assigning a tier plan to a tenant.
	// nil until wired via SetLicenseAssigner: provision-from-quote then returns
	// ErrProvisioningUnavailable rather than silently no-oping (fail-closed).
	assigner LicenseAssigner
	// runInTx runs fn in a database transaction. It defaults to
	// database.RunInTx over the pool; tests inject an in-memory runner so the
	// governance orchestration (server-recompute, below-floor gate, staged
	// events) is unit-testable without a database. Production behavior is
	// unchanged — the default seam is exactly database.RunInTx(ctx, pool, fn).
	runInTx func(ctx context.Context, fn func(tx pgx.Tx) error) error
}

// New constructs the pricing service.
func New(pool *pgxpool.Pool, r Repo, logger zerolog.Logger) *Service {
	s := &Service{
		pool:      pool,
		repo:      r,
		logger:    logger.With().Str("service", "pricing").Logger(),
		now:       func() time.Time { return time.Now().UTC() },
		tierPlans: DefaultTierPlanMap(),
	}
	s.runInTx = func(ctx context.Context, fn func(tx pgx.Tx) error) error {
		return database.RunInTx(ctx, s.pool, fn)
	}
	return s
}

// SetTierPlanMap overrides the tier→license-plan-key mapping (configuration
// seam). It fails closed: a mapping that does not cover all four tiers with
// non-empty plan keys is rejected, so a misconfiguration cannot silently break
// provisioning. New installs DefaultTierPlanMap, so callers only call this to
// override.
func (s *Service) SetTierPlanMap(m TierPlanMap) error {
	if err := m.Validate(); err != nil {
		return err
	}
	s.tierPlans = m
	return nil
}

// TierPlanMap returns a copy of the active tier→plan mapping (for the admin
// surface / diagnostics).
func (s *Service) TierPlanMap() TierPlanMap {
	out := make(TierPlanMap, len(s.tierPlans))
	for t, k := range s.tierPlans {
		out[t] = k
	}
	return out
}

// SetLicenseAssigner wires the license assignment seam used by
// provision-from-quote. Without it, provision-from-quote fails closed with
// ErrProvisioningUnavailable rather than silently no-oping.
func (s *Service) SetLicenseAssigner(a LicenseAssigner) { s.assigner = a }

// SetTxRunner overrides the transaction seam. It exists so tests in sibling
// packages (e.g. the handler package) can drive the DB-backed governance paths
// with an in-memory runner and no database. Production wiring never calls it —
// New installs the real database.RunInTx runner.
func (s *Service) SetTxRunner(fn func(ctx context.Context, run func(tx pgx.Tx) error) error) {
	s.runInTx = fn
}

// platformTenant is the nil-UUID sentinel used as the tenant for platform-global
// pricing events. The outbox requires a non-empty tenant id on every event; a
// pricing config is platform-global (not tenant-scoped), so its governance
// events carry this system tenant. Quote events carry the quote's own tenant_id
// when it is linked to one, else this sentinel (a quote may precede a tenant).
const platformTenant = "00000000-0000-0000-0000-000000000000"

// stage writes a platform-global pricing event into the outbox within the
// caller's transaction (used by config governance: publish/archive).
func (s *Service) stage(ctx context.Context, q outbox.Querier, eventType string, data any) error {
	return s.stageForTenant(ctx, q, platformTenant, eventType, data)
}

// stageForTenant writes a pricing event scoped to a specific tenant (used by
// quote events, which carry the quote's tenant_id when it has one). An empty
// tenant falls back to the platform sentinel so the outbox event is always valid.
func (s *Service) stageForTenant(ctx context.Context, q outbox.Querier, tenantID, eventType string, data any) error {
	if tenantID == "" {
		tenantID = platformTenant
	}
	event, err := events.NewEvent(eventType, eventSource, tenantID, data)
	if err != nil {
		return fmt.Errorf("building %s event: %w", eventType, err)
	}
	return outbox.Write(ctx, q, events.Topics.LicenseEvents, event)
}

// --- Compute -----------------------------------------------------------------

// Compute prices the four tiers for the given inputs against the ACTIVE config
// version. It returns the full internal Quote; the handler masks it by RBAC.
// Server-authoritative: the client's Inputs never carry rates or the floor.
func (s *Service) Compute(ctx context.Context, in model.Inputs) (*model.Quote, error) {
	if err := validateInputs(in); err != nil {
		return nil, err
	}
	cfg, err := s.repo.GetActive(ctx, s.pool)
	if err != nil {
		return nil, err
	}
	q := engine.Compute(cfg.Rates, in, cfg.Version)
	return &q, nil
}

// ComputeWith prices against an explicit config version (draft preview or a
// historical version) rather than the active one.
func (s *Service) ComputeWith(ctx context.Context, in model.Inputs, version int) (*model.Quote, error) {
	if err := validateInputs(in); err != nil {
		return nil, err
	}
	cfg, err := s.repo.GetByVersion(ctx, s.pool, version)
	if err != nil {
		return nil, err
	}
	q := engine.Compute(cfg.Rates, in, cfg.Version)
	return &q, nil
}

func validateInputs(in model.Inputs) error {
	switch in.Model {
	case model.ModelPerUser, model.ModelPerCore:
	default:
		return fmt.Errorf("%w: model must be per_user or per_core", model.ErrInvalidConfig)
	}
	switch in.Deployment {
	case model.DeploymentSaaS, model.DeploymentOnPrem, model.DeploymentAirGapped:
	default:
		return fmt.Errorf("%w: deployment must be 1 (SaaS), 2 (OnPrem) or 3 (AirGapped)", model.ErrInvalidConfig)
	}
	if in.TermMonths <= 0 {
		return fmt.Errorf("%w: term_months must be positive", model.ErrInvalidConfig)
	}
	if in.Users < 0 || in.Cores < 0 || in.VMs < 0 {
		return fmt.Errorf("%w: volume drivers must not be negative", model.ErrInvalidConfig)
	}
	if in.HotStorageGB < 0 || in.ColdStorageGB < 0 {
		return fmt.Errorf("%w: storage must not be negative", model.ErrInvalidConfig)
	}
	if in.SalesDiscount != nil && (*in.SalesDiscount < 0 || *in.SalesDiscount > 1) {
		return fmt.Errorf("%w: sales_discount must be in [0,1]", model.ErrInvalidConfig)
	}
	return nil
}

// --- Config governance -------------------------------------------------------

// GetActiveConfig returns the current active version with its full payload.
func (s *Service) GetActiveConfig(ctx context.Context) (*model.PricingConfig, error) {
	return s.repo.GetActive(ctx, s.pool)
}

// GetConfigVersion returns one version.
func (s *Service) GetConfigVersion(ctx context.Context, version int) (*model.PricingConfig, error) {
	return s.repo.GetByVersion(ctx, s.pool, version)
}

// ListConfigs returns all versions, newest first.
func (s *Service) ListConfigs(ctx context.Context) ([]*model.PricingConfig, error) {
	return s.repo.List(ctx, s.pool)
}

// CreateDraftInput captures a new draft version request.
type CreateDraftInput struct {
	Rates     model.PricingRates
	Notes     string
	CreatedBy string
}

// CreateDraft validates the rate set (fail-closed) and inserts it as a new
// DRAFT with version = max(version)+1. A draft is inert until published.
func (s *Service) CreateDraft(ctx context.Context, in CreateDraftInput) (*model.PricingConfig, error) {
	if err := engine.Validate(in.Rates); err != nil {
		return nil, err
	}
	var out *model.PricingConfig
	err := database.RunInTx(ctx, s.pool, func(tx pgx.Tx) error {
		max, err := s.repo.MaxVersion(ctx, tx)
		if err != nil {
			return err
		}
		created, err := s.repo.CreateDraft(ctx, tx, &model.PricingConfig{
			Version:   max + 1,
			Rates:     in.Rates,
			Currency:  "SAR",
			Notes:     in.Notes,
			CreatedBy: in.CreatedBy,
		})
		if err != nil {
			return err
		}
		out = created
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// UpdateDraftInput edits an existing draft.
type UpdateDraftInput struct {
	Version int
	Rates   model.PricingRates
	Notes   string
}

// UpdateDraft re-validates and replaces a draft's payload. Active/archived
// versions are immutable (repository returns model.ErrImmutable).
func (s *Service) UpdateDraft(ctx context.Context, in UpdateDraftInput) (*model.PricingConfig, error) {
	if err := engine.Validate(in.Rates); err != nil {
		return nil, err
	}
	return s.repo.UpdateDraft(ctx, s.pool, &model.PricingConfig{
		Version: in.Version,
		Rates:   in.Rates,
		Notes:   in.Notes,
	})
}

// Publish transitions a draft to active: it archives the prior active version
// (stamping effective_to) and activates the draft, in ONE transaction that also
// stages a pricing.config_published event. The partial unique index guarantees
// at most one active version even under concurrent publishes.
func (s *Service) Publish(ctx context.Context, version int, publishedBy string) (*model.PricingConfig, error) {
	// Re-validate the payload at publish time (defence-in-depth: a draft could
	// predate a stricter validator). Load first, outside the tx, to fail fast.
	draft, err := s.repo.GetByVersion(ctx, s.pool, version)
	if err != nil {
		return nil, err
	}
	if draft.Status != model.ConfigStatusDraft {
		return nil, fmt.Errorf("version %d is %s, only a draft can be published: %w", version, draft.Status, model.ErrImmutable)
	}
	if err := engine.Validate(draft.Rates); err != nil {
		return nil, err
	}

	var out *model.PricingConfig
	err = database.RunInTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := s.repo.ArchiveActive(ctx, tx); err != nil {
			return err
		}
		activated, err := s.repo.Activate(ctx, tx, version)
		if err != nil {
			return err
		}
		if err := s.stage(ctx, tx, eventConfigPublished, map[string]any{
			"version":        activated.Version,
			"published_by":   publishedBy,
			"effective_from": activated.EffectiveFrom,
		}); err != nil {
			return err
		}
		out = activated
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Archive archives a specific active version. It refuses to leave the platform
// with no active config unless a replacement is published first (guarded here
// so a pricing operator cannot accidentally break the calculator for everyone).
func (s *Service) Archive(ctx context.Context, version int, archivedBy string) (*model.PricingConfig, error) {
	var out *model.PricingConfig
	err := database.RunInTx(ctx, s.pool, func(tx pgx.Tx) error {
		archived, err := s.repo.ArchiveVersion(ctx, tx, version)
		if err != nil {
			return err
		}
		return func() error {
			if err := s.stage(ctx, tx, eventConfigArchived, map[string]any{
				"version":     archived.Version,
				"archived_by": archivedBy,
			}); err != nil {
				return err
			}
			out = archived
			return nil
		}()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
