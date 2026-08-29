package registry

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const eventSource = "clario-dr-service"

// Event types emitted on datastream.dr.events when a runbook version is stored.
const (
	eventRunbookGenerated   = "datastream.dr.runbook.generated"
	eventRunbookRegenerated = "datastream.dr.runbook.regenerated"
)

// storeAPI is the persistence surface the generator needs. *Store satisfies it;
// tests substitute an in-memory fake so the generator's regenerate/diff logic is
// exercised without a database, while the integration path uses the real Store.
type storeAPI interface {
	LoadAssetSnapshot(ctx context.Context, db DBTX, groupID, profile string) (AssetSnapshot, error)
	EnsureRunbook(ctx context.Context, db DBTX, tenantID, groupID, templateID string) (*Runbook, error)
	GetRunbook(ctx context.Context, db DBTX, groupID string) (*Runbook, error)
	GetLatestVersion(ctx context.Context, db DBTX, runbookID string) (*RunbookVersion, error)
	InsertVersion(ctx context.Context, db DBTX, v *RunbookVersion) (*RunbookVersion, error)
}

// templateAPI materializes a snapshot into ordered steps. *Template satisfies it.
type templateAPI interface {
	ID() string
	Materialize(snap AssetSnapshot) ([]RunbookStep, error)
}

// txRunner runs a function inside a tenant-scoped transaction (RLS sees the
// tenant) so a request-path regenerate commits the version row and its outbox
// event atomically. The reconcile loop uses RunSystem instead (cross-tenant).
type txRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunSystem(ctx context.Context, fn func(DBTX) error) error
	RunSystemRead(ctx context.Context, fn func(DBTX) error) error
}

// PGXRunner adapts a *pgxpool.Pool to txRunner using the platform's tenant and
// system transaction helpers. RunWithTenant/RunReadWithTenant set
// app.current_tenant_id so RLS scopes the runbook + asset reads to the caller;
// RunSystem/RunSystemRead set app.bypass_rls for the cross-tenant reconcile loop
// (the single, clearly-named system path the design reserves for background
// loops, §7).
type PGXRunner struct {
	Pool *pgxpool.Pool
}

// RunWithTenant runs fn in a read-write tenant transaction.
func (r PGXRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunReadWithTenant runs fn in a read-only tenant transaction.
func (r PGXRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunSystem runs fn in a read-write system transaction (RLS bypassed).
func (r PGXRunner) RunSystem(ctx context.Context, fn func(DBTX) error) error {
	return database.RunSystemTx(ctx, r.Pool, func(tx pgx.Tx) error { return fn(tx) })
}

// RunSystemRead runs fn in a read-only system transaction (RLS bypassed).
func (r PGXRunner) RunSystemRead(ctx context.Context, fn func(DBTX) error) error {
	return database.RunSystemRead(ctx, r.Pool, func(tx pgx.Tx) error { return fn(tx) })
}

// eventStager stages a lifecycle event in the caller's transaction. The default
// implementation writes to the transactional outbox so the event commits
// atomically with the version row.
type eventStager interface {
	Stage(ctx context.Context, tx DBTX, eventType, tenantID string, data map[string]any) error
}

type outboxStager struct{}

func (outboxStager) Stage(ctx context.Context, tx DBTX, eventType, tenantID string, data map[string]any) error {
	evt, err := events.NewEvent(eventType, eventSource, tenantID, data)
	if err != nil {
		return fmt.Errorf("registry: building %s event: %w", eventType, err)
	}
	return outbox.Write(ctx, tx, events.Topics.DREvents, evt)
}

// Generator is the self-maintaining runbook engine: it loads a group's real
// assets, materializes them through the template, diffs the result against the
// current stored version, and — only when the materialized steps actually
// changed — stores a new immutable version (advancing current_version) and
// stages a lifecycle event in the same transaction. This is the Cutover
// "template x asset data = self-maintaining runbook".
type Generator struct {
	store    storeAPI
	template templateAPI
	runner   txRunner
	stager   eventStager
	metrics  *Metrics
	logger   zerolog.Logger
}

// GeneratorConfig wires a Generator.
type GeneratorConfig struct {
	Store    storeAPI
	Template templateAPI
	Runner   txRunner
	// Stager is optional; defaults to the transactional-outbox stager.
	Stager  eventStager
	Metrics *Metrics
	Logger  zerolog.Logger
}

// NewGenerator constructs a Generator. Store, Template and Runner are required.
func NewGenerator(cfg GeneratorConfig) (*Generator, error) {
	if cfg.Store == nil {
		return nil, errors.New("registry generator: store is required")
	}
	if cfg.Template == nil {
		return nil, errors.New("registry generator: template is required")
	}
	if cfg.Runner == nil {
		return nil, errors.New("registry generator: runner is required")
	}
	stager := cfg.Stager
	if stager == nil {
		stager = outboxStager{}
	}
	return &Generator{
		store:    cfg.Store,
		template: cfg.Template,
		runner:   cfg.Runner,
		stager:   stager,
		metrics:  cfg.Metrics,
		logger:   cfg.Logger,
	}, nil
}

// RegenerateResult reports the outcome of a regeneration.
type RegenerateResult struct {
	// Version is the resulting runbook version (the new one when Changed, or the
	// unchanged current one when not).
	Version *RunbookVersion
	// Changed reports whether a new version was actually stored (the materialized
	// steps differed from the current version). A no-op regeneration returns the
	// current version with Changed=false and stores nothing.
	Changed bool
	// Diff is the step-level diff that justified the new version (nil when the
	// runbook had no prior version — the first generation — or when unchanged).
	Diff *RunbookDiff
}

// Regenerate materializes the group's current assets through the template and
// stores a new version IFF the result differs from the current version. It runs
// inside ONE tenant transaction so the asset read, the version insert, the
// current_version advance, and the outbox event all commit atomically — a
// regeneration is never half-applied and never publishes an event for a write
// that rolled back. trigger records what caused it (manual/membership/...).
//
// profile selects the network mapping the runbook documents ("production" for a
// real failover, "isolated" for a drill rehearsal); empty defaults to
// production.
func (g *Generator) Regenerate(ctx context.Context, tenantID uuid.UUID, groupID, profile, trigger string) (RegenerateResult, error) {
	if trigger == "" {
		trigger = TriggerManual
	}
	var result RegenerateResult
	err := g.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		res, err := g.regenerateInTx(ctx, tx, tenantID.String(), groupID, profile, trigger)
		if err != nil {
			return err
		}
		result = res
		return nil
	})
	if err != nil {
		return RegenerateResult{}, err
	}
	g.metrics.observeRegeneration(trigger, result.Changed, groupID, versionNumber(result.Version), stepCount(result.Version))
	return result, nil
}

// regenerateInTx performs the regeneration within an already-open transaction.
// It is shared by the request-path Regenerate (tenant tx) and the reconcile loop
// (system tx) so both paths run identical diff/version logic.
func (g *Generator) regenerateInTx(ctx context.Context, tx DBTX, tenantID, groupID, profile, trigger string) (RegenerateResult, error) {
	snap, err := g.store.LoadAssetSnapshot(ctx, tx, groupID, profile)
	if err != nil {
		return RegenerateResult{}, err
	}
	steps, err := g.template.Materialize(snap)
	if err != nil {
		return RegenerateResult{}, err
	}
	hash := ContentHash(g.template.ID(), steps)

	rb, err := g.store.EnsureRunbook(ctx, tx, tenantID, groupID, g.template.ID())
	if err != nil {
		return RegenerateResult{}, err
	}

	var prev *RunbookVersion
	if rb.CurrentVersion > 0 {
		prev, err = g.store.GetLatestVersion(ctx, tx, rb.ID)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return RegenerateResult{}, err
		}
	}

	// No-op detection: identical content hash means the materialized runbook is
	// byte-identical to the current version, so do not store a duplicate.
	if prev != nil && prev.ContentHash == hash {
		return RegenerateResult{Version: prev, Changed: false}, nil
	}

	var diff *RunbookDiff
	eventType := eventRunbookGenerated
	if prev != nil {
		d := DiffSteps(prev.Steps, steps)
		diff = &d
		eventType = eventRunbookRegenerated
		// Defence in depth: the hash already differs, but if the diff is somehow
		// empty (e.g. only a non-step field would have changed), treat it as a
		// no-op so the version history records only real step changes.
		if d.IsEmpty() {
			return RegenerateResult{Version: prev, Changed: false}, nil
		}
	}

	newVersion := &RunbookVersion{
		RunbookID:     rb.ID,
		TenantID:      tenantID,
		GroupID:       groupID,
		Version:       rb.CurrentVersion + 1,
		TemplateID:    g.template.ID(),
		Steps:         steps,
		AssetSnapshot: snap,
		ContentHash:   hash,
		Diff:          diff,
		Trigger:       trigger,
	}
	stored, err := g.store.InsertVersion(ctx, tx, newVersion)
	if err != nil {
		return RegenerateResult{}, err
	}

	// Stage the lifecycle event in the same transaction (exactly-once: it commits
	// or rolls back with the version row).
	eventData := map[string]any{
		"group_id":    groupID,
		"runbook_id":  rb.ID,
		"version":     stored.Version,
		"template_id": g.template.ID(),
		"trigger":     trigger,
		"step_count":  len(steps),
	}
	if diff != nil {
		eventData["added"] = len(diff.Added)
		eventData["removed"] = len(diff.Removed)
		eventData["reordered"] = len(diff.Reordered)
		eventData["changed"] = len(diff.Changed)
	}
	if err := g.stager.Stage(ctx, tx, eventType, tenantID, eventData); err != nil {
		return RegenerateResult{}, err
	}

	return RegenerateResult{Version: stored, Changed: true, Diff: diff}, nil
}

// GetRunbook returns the current runbook version for a group in a read-only
// tenant transaction. It returns ErrNotFound when no runbook has been generated
// yet, so the caller can choose to generate one on demand.
func (g *Generator) GetRunbook(ctx context.Context, tenantID uuid.UUID, groupID string) (*Runbook, *RunbookVersion, error) {
	var rb *Runbook
	var ver *RunbookVersion
	err := g.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var rerr error
		rb, rerr = g.store.GetRunbook(ctx, tx, groupID)
		if rerr != nil {
			return rerr
		}
		ver, rerr = g.store.GetLatestVersion(ctx, tx, rb.ID)
		return rerr
	})
	if err != nil {
		return nil, nil, err
	}
	return rb, ver, nil
}

// GetOrGenerate returns the current runbook version, generating the first
// version on demand when none exists yet (so GET /runbook is useful immediately
// after the assets are defined). It uses the read path first and only takes the
// write path on a miss.
func (g *Generator) GetOrGenerate(ctx context.Context, tenantID uuid.UUID, groupID, profile string) (*RunbookVersion, error) {
	_, ver, err := g.GetRunbook(ctx, tenantID, groupID)
	if err == nil {
		return ver, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	res, err := g.Regenerate(ctx, tenantID, groupID, profile, TriggerManual)
	if err != nil {
		return nil, err
	}
	return res.Version, nil
}

// ListVersions returns all stored versions of a group's runbook (newest first)
// in a read-only tenant transaction.
func (g *Generator) ListVersions(ctx context.Context, tenantID uuid.UUID, groupID string) ([]*RunbookVersion, error) {
	st, ok := g.store.(interface {
		ListVersions(ctx context.Context, db DBTX, runbookID string) ([]*RunbookVersion, error)
	})
	if !ok {
		return nil, errors.New("registry: store does not support listing versions")
	}
	var out []*RunbookVersion
	err := g.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		rb, rerr := g.store.GetRunbook(ctx, tx, groupID)
		if rerr != nil {
			return rerr
		}
		out, rerr = st.ListVersions(ctx, tx, rb.ID)
		return rerr
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// regenerateSystem regenerates a group's runbook under a system (RLS-bypass)
// transaction. It is the reconcile loop's entry point: the loop consumes
// datastream.dr.events across tenants, so it cannot assume a single tenant
// context. tenantID is taken from the event so the stored rows still carry the
// correct tenant_id. The whole regeneration commits in one transaction.
func (g *Generator) regenerateSystem(ctx context.Context, tenantID, groupID, profile, trigger string) (RegenerateResult, error) {
	if trigger == "" {
		trigger = TriggerManual
	}
	var result RegenerateResult
	err := g.runner.RunSystem(ctx, func(tx DBTX) error {
		res, err := g.regenerateInTx(ctx, tx, tenantID, groupID, profile, trigger)
		if err != nil {
			return err
		}
		result = res
		return nil
	})
	if err != nil {
		return RegenerateResult{}, err
	}
	g.metrics.observeRegeneration(trigger, result.Changed, groupID, versionNumber(result.Version), stepCount(result.Version))
	return result, nil
}

func versionNumber(v *RunbookVersion) int {
	if v == nil {
		return 0
	}
	return v.Version
}

func stepCount(v *RunbookVersion) int {
	if v == nil {
		return 0
	}
	return len(v.Steps)
}

// compile-time checks.
var (
	_ storeAPI    = (*Store)(nil)
	_ templateAPI = (*Template)(nil)
	_ txRunner    = PGXRunner{}
	_ eventStager = outboxStager{}
	_ repository.DBTX
)
