package recover

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/recover/metastore"
)

// ErrNoSubSolutionsSelected is returned when an onboarding activation request
// selects zero sub-solutions; onboarding must activate at least one.
var ErrNoSubSolutionsSelected = errors.New("recover onboarding: at least one sub-solution must be selected")

// activator is the narrow seam onto the Recover product Service the onboarding
// flow uses to record a tenant's activation choice (the Prompt 1 entitlement
// model). *Service satisfies it; the interface keeps the onboarding service
// unit-testable without a database or live licensing engine.
type activator interface {
	SetActivation(ctx context.Context, tenantID uuid.UUID, subSolution string, activated bool) (*Activation, error)
}

// demoRegistry is the narrow Metastore seam the onboarding demo seeder composes:
// it creates the demo applications (real records via the real CreateApplication
// path) and deletes them on removal (the metastore delete cascades the app's
// children and runbook links). *metastore.DefaultRegistry satisfies it.
type demoRegistry interface {
	CreateApplication(ctx context.Context, tenantID uuid.UUID, in metastore.ApplicationInput) (*metastore.Application, error)
	ResolveApplicationByKey(ctx context.Context, tenantID uuid.UUID, appKey string) (*metastore.Application, error)
	DeleteApplication(ctx context.Context, tenantID uuid.UUID, id string) error
}

// demoPopulator is the narrow Metastore-populate seam the onboarding demo seeder
// composes to materialize a real demo runbook from a demo application's metadata
// — it drives the EXISTING Runbook Studio through the metastore populator,
// reimplementing no runbook authoring. *metastore.Populator satisfies it.
type demoPopulator interface {
	Populate(ctx context.Context, tenantID uuid.UUID, appID string, createdBy *string) (*metastore.PopulateResult, error)
}

// OnboardingConfig wires an OnboardingService.
type OnboardingConfig struct {
	// Activator records the tenant's sub-solution activation choice (Prompt 1).
	Activator activator
	// Registry is the Application Metastore seam used to create/delete the demo
	// applications (real records, real path).
	Registry demoRegistry
	// Populator materializes a real demo runbook from each demo application's
	// metadata by composing Runbook Studio.
	Populator demoPopulator
	// Runner runs tenant-scoped transactions for the demo-seed ledger and the
	// runbook removal.
	Runner TenantRunner
	// SeedStore persists the demo-seed ledger (idempotency + precise removal).
	SeedStore DemoSeedStore
	// RunbookDeleter removes a demo-seeded runbook on removal (cascades its
	// tasks/runs).
	RunbookDeleter RunbookDeleter
	// Logger is the structured logger; required.
	Logger zerolog.Logger
	// Now is injectable for deterministic tests; defaults to time.Now().UTC().
	Now func() time.Time
}

// OnboardingService implements the Recover onboarding step: a tenant selects
// which sub-solutions to activate, the service writes the corresponding
// activation (the Prompt 1 entitlement model) and SEEDS realistic demo content
// per selected sub-solution — real applications in the Application Metastore and
// a real runbook materialized from each, so the product lands populated and
// navigable. Seeding is idempotent (a demo-seed ledger guards against
// duplication) and the demo content is namespaced and fully removable via
// RemoveDemoData. It COMPOSES the existing Recover/Metastore/Studio services; it
// owns no recovery logic.
type OnboardingService struct {
	activator activator
	registry  demoRegistry
	populator demoPopulator
	runner    TenantRunner
	seedStore DemoSeedStore
	deleter   RunbookDeleter
	logger    zerolog.Logger
	now       func() time.Time
}

// NewOnboardingService validates the config and constructs the service.
func NewOnboardingService(cfg OnboardingConfig) (*OnboardingService, error) {
	if cfg.Activator == nil {
		return nil, errors.New("recover onboarding: activator is required")
	}
	if cfg.Registry == nil {
		return nil, errors.New("recover onboarding: metastore registry is required")
	}
	if cfg.Populator == nil {
		return nil, errors.New("recover onboarding: metastore populator is required")
	}
	if cfg.Runner == nil {
		return nil, errors.New("recover onboarding: runner is required")
	}
	if cfg.SeedStore == nil {
		return nil, errors.New("recover onboarding: seed store is required")
	}
	if cfg.RunbookDeleter == nil {
		return nil, errors.New("recover onboarding: runbook deleter is required")
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &OnboardingService{
		activator: cfg.Activator,
		registry:  cfg.Registry,
		populator: cfg.Populator,
		runner:    cfg.Runner,
		seedStore: cfg.SeedStore,
		deleter:   cfg.RunbookDeleter,
		logger:    cfg.Logger.With().Str("service", "recover-onboarding").Logger(),
		now:       now,
	}, nil
}

// SubSolutionSeedResult reports, per selected sub-solution, the activation and
// the demo entities seeded (or found already present). It is the onboarding
// response so the UI can land the tenant straight into a populated product.
type SubSolutionSeedResult struct {
	SubSolution      string   `json:"sub_solution"`
	Activated        bool     `json:"activated"`
	AlreadySeeded    bool     `json:"already_seeded"`
	ApplicationKeys  []string `json:"application_keys"`
	ApplicationCount int      `json:"application_count"`
	RunbookCount     int      `json:"runbook_count"`
}

// OnboardResult is the full outcome of an onboarding activation: the per
// sub-solution activation + seed results.
type OnboardResult struct {
	Results []SubSolutionSeedResult `json:"results"`
}

// Onboard activates the selected sub-solutions for the tenant and seeds demo
// content for each. selected is the set of sub-solution slugs the tenant chose;
// every slug is validated against the registry (an unknown slug is rejected, no
// partial activation). createdBy is the acting user, recorded as the demo
// runbooks' author. The whole operation is idempotent: re-onboarding the same
// sub-solutions re-asserts activation and does not duplicate demo content (the
// demo-seed ledger short-circuits a sub-solution that already has demo apps).
func (s *OnboardingService) Onboard(ctx context.Context, tenantID uuid.UUID, selected []string, createdBy *string) (*OnboardResult, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("recover onboarding: tenant id is required")
	}
	if len(selected) == 0 {
		return nil, ErrNoSubSolutionsSelected
	}

	// Validate + de-duplicate the selection up front so a bad slug fails the whole
	// request before any state is written (no partial activation).
	ordered, err := normalizeSelection(selected)
	if err != nil {
		return nil, err
	}

	results := make([]SubSolutionSeedResult, 0, len(ordered))
	for _, slug := range ordered {
		// Record the activation choice (the Prompt 1 entitlement model). This is the
		// real write the onboarding step exists to make.
		if _, aerr := s.activator.SetActivation(ctx, tenantID, slug, true); aerr != nil {
			return nil, fmt.Errorf("activate %s: %w", slug, aerr)
		}

		res, serr := s.seedSubSolution(ctx, tenantID, slug, createdBy)
		if serr != nil {
			return nil, fmt.Errorf("seed %s: %w", slug, serr)
		}
		results = append(results, res)
	}

	s.logger.Info().
		Str("tenant_id", tenantID.String()).
		Strs("sub_solutions", ordered).
		Msg("recover onboarding activated sub-solutions and seeded demo content")

	return &OnboardResult{Results: results}, nil
}

// seedSubSolution seeds the demo content for one sub-solution idempotently. It
// first checks the demo-seed ledger: if the sub-solution already has demo apps,
// it is a no-op (AlreadySeeded). Otherwise it creates each demo application via
// the REAL metastore CreateApplication path, materializes a REAL runbook from it
// via the populate path (which composes Runbook Studio), and records both in the
// ledger so the content is removable and a re-seed is a no-op.
func (s *OnboardingService) seedSubSolution(ctx context.Context, tenantID uuid.UUID, slug string, createdBy *string) (SubSolutionSeedResult, error) {
	res := SubSolutionSeedResult{SubSolution: slug, Activated: true}

	existing, err := s.countSeeded(ctx, tenantID, slug)
	if err != nil {
		return res, err
	}
	if existing > 0 {
		// Already seeded: report what is present without re-creating it.
		res.AlreadySeeded = true
		keys, scerr := s.seededAppKeys(ctx, tenantID, slug)
		if scerr != nil {
			return res, scerr
		}
		res.ApplicationKeys = keys
		res.ApplicationCount = len(keys)
		return res, nil
	}

	for _, tmpl := range demoTemplates(slug) {
		app, cerr := s.createDemoApplication(ctx, tenantID, slug, tmpl)
		if cerr != nil {
			return res, cerr
		}

		// Materialize a real runbook from the demo application's metadata (composes
		// Runbook Studio via the metastore populator) so the dashboards/analytics
		// have a real, linked runbook to read — not an empty product.
		pop, perr := s.populator.Populate(ctx, tenantID, app.ID, createdBy)
		if perr != nil {
			return res, fmt.Errorf("populate demo runbook for %s: %w", app.AppKey, perr)
		}
		if rerr := s.recordItem(ctx, tenantID, DemoSeedItem{
			SubSolution: slug,
			Kind:        DemoKindRunbook,
			RefID:       pop.RunbookID,
			AppKey:      app.AppKey,
		}); rerr != nil {
			return res, rerr
		}

		res.ApplicationKeys = append(res.ApplicationKeys, app.AppKey)
		res.ApplicationCount++
		res.RunbookCount++
	}

	s.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("sub_solution", slug).
		Int("applications", res.ApplicationCount).
		Int("runbooks", res.RunbookCount).
		Msg("recover onboarding seeded demo content")

	return res, nil
}

// createDemoApplication creates one demo application via the real metastore
// CreateApplication path and records it in the demo-seed ledger. If a demo app
// with the same app_key already exists (a partially-completed earlier seed where
// the app landed but the ledger row did not), it adopts the existing app and
// re-asserts the ledger row rather than failing — keeping the seed idempotent.
func (s *OnboardingService) createDemoApplication(ctx context.Context, tenantID uuid.UUID, slug string, tmpl demoApplicationTemplate) (*metastore.Application, error) {
	app, err := s.registry.CreateApplication(ctx, tenantID, tmpl.Input)
	if err != nil {
		if errors.Is(err, metastore.ErrAlreadyExists) {
			existing, gerr := s.registry.ResolveApplicationByKey(ctx, tenantID, tmpl.Input.AppKey)
			if gerr != nil {
				return nil, gerr
			}
			app = existing
		} else {
			return nil, fmt.Errorf("create demo application %s: %w", tmpl.Input.AppKey, err)
		}
	}
	if rerr := s.recordItem(ctx, tenantID, DemoSeedItem{
		SubSolution: slug,
		Kind:        DemoKindMetastoreApplication,
		RefID:       app.ID,
		AppKey:      app.AppKey,
	}); rerr != nil {
		return nil, rerr
	}
	return app, nil
}

// RemoveDemoResult reports what the one-click "remove demo data" action removed.
type RemoveDemoResult struct {
	RunbooksRemoved     int `json:"runbooks_removed"`
	ApplicationsRemoved int `json:"applications_removed"`
}

// RemoveDemoData removes ALL demo content for the tenant: every demo-seeded
// runbook (deleted directly; cascades its tasks/runs) and every demo-seeded
// Metastore application (deleted via the registry; cascades its children and
// runbook links), then the demo-seed ledger rows. It is idempotent — a tenant
// with no demo content yields a zero result. Runbooks are deleted before their
// applications so a runbook is never orphaned mid-removal. Application
// deletions go through the registry (its own tenant transaction); the ledger
// row for each is deleted only after its entity is gone, so a failure leaves a
// retry-able ledger.
func (s *OnboardingService) RemoveDemoData(ctx context.Context, tenantID uuid.UUID) (*RemoveDemoResult, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("recover onboarding: tenant id is required")
	}

	items, err := s.listItems(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	out := &RemoveDemoResult{}

	// Remove runbooks first (each delete + its ledger row in one tenant tx), then
	// applications. Deleting a runbook before the app it links to avoids a window
	// where the app delete cascades the link out from under a still-listed runbook.
	for _, it := range items {
		if it.Kind != DemoKindRunbook {
			continue
		}
		if derr := s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
			if e := s.deleter.DeleteRunbook(ctx, db, it.RefID); e != nil {
				return e
			}
			return s.seedStore.DeleteItem(ctx, db, tenantID, it.Kind, it.RefID)
		}); derr != nil {
			return out, fmt.Errorf("remove demo runbook %s: %w", it.RefID, derr)
		}
		out.RunbooksRemoved++
	}

	for _, it := range items {
		if it.Kind != DemoKindMetastoreApplication {
			continue
		}
		// The registry delete cascades the app's children + runbook links in its own
		// tenant transaction; the ledger row is then removed.
		if e := s.registry.DeleteApplication(ctx, tenantID, it.RefID); e != nil {
			return out, fmt.Errorf("remove demo application %s: %w", it.RefID, e)
		}
		if derr := s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
			return s.seedStore.DeleteItem(ctx, db, tenantID, it.Kind, it.RefID)
		}); derr != nil {
			return out, fmt.Errorf("remove demo application ledger %s: %w", it.RefID, derr)
		}
		out.ApplicationsRemoved++
	}

	s.logger.Info().
		Str("tenant_id", tenantID.String()).
		Int("runbooks_removed", out.RunbooksRemoved).
		Int("applications_removed", out.ApplicationsRemoved).
		Msg("recover onboarding removed demo content")

	return out, nil
}

// countSeeded counts the demo applications for a sub-solution in a read tx.
func (s *OnboardingService) countSeeded(ctx context.Context, tenantID uuid.UUID, slug string) (int, error) {
	var n int
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var rerr error
		n, rerr = s.seedStore.CountForSubSolution(ctx, db, tenantID, slug)
		return rerr
	})
	return n, err
}

// seededAppKeys returns the demo application keys for a sub-solution.
func (s *OnboardingService) seededAppKeys(ctx context.Context, tenantID uuid.UUID, slug string) ([]string, error) {
	items, err := s.listItems(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	var keys []string
	for _, it := range items {
		if it.SubSolution == slug && it.Kind == DemoKindMetastoreApplication {
			keys = append(keys, it.AppKey)
		}
	}
	return keys, nil
}

// listItems reads every demo-seed ledger row for the tenant in a read tx.
func (s *OnboardingService) listItems(ctx context.Context, tenantID uuid.UUID) ([]DemoSeedItem, error) {
	var items []DemoSeedItem
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var rerr error
		items, rerr = s.seedStore.ListItems(ctx, db, tenantID)
		return rerr
	})
	return items, err
}

// recordItem writes one demo-seed ledger row in a write tx.
func (s *OnboardingService) recordItem(ctx context.Context, tenantID uuid.UUID, item DemoSeedItem) error {
	now := s.now()
	return s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		return s.seedStore.RecordItem(ctx, db, tenantID, item, now)
	})
}

// normalizeSelection validates every slug against the registry and returns the
// de-duplicated selection in stable registry order, so onboarding seeds in a
// deterministic order (IT DR, Cloud DR, Cyber Recovery). An unknown slug is
// rejected before any state is written.
func normalizeSelection(selected []string) ([]string, error) {
	chosen := make(map[string]bool, len(selected))
	for _, slug := range selected {
		if _, ok := entitlementKeyForSubSolution(slug); !ok {
			return nil, fmt.Errorf("%w: %q", ErrUnknownSubSolution, slug)
		}
		chosen[slug] = true
	}
	ordered := make([]string, 0, len(chosen))
	for _, slug := range SubSolutionIDs() {
		if chosen[slug] {
			ordered = append(ordered, slug)
		}
	}
	return ordered, nil
}
