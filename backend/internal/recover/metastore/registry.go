package metastore

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
)

// storeAPI is the persistence surface the registry needs. *Store satisfies it;
// tests substitute an in-memory fake so the validation / population / drift
// logic is exercised without a database while the SQL store is covered by an
// integration test.
type storeAPI interface {
	GetApplicationByID(ctx context.Context, db DBTX, tenantID, id string) (*Application, error)
	GetApplicationByKey(ctx context.Context, db DBTX, tenantID, appKey string) (*Application, error)
	ListApplications(ctx context.Context, db DBTX, tenantID string, limit, offset int) (ListPage, error)
	InsertApplication(ctx context.Context, db DBTX, tenantID string, app Application, now time.Time) (string, error)
	UpdateApplicationScalars(ctx context.Context, db DBTX, tenantID, id string, app Application, now time.Time) error
	ReplaceChildren(ctx context.Context, db DBTX, tenantID, appID string, app Application) error
	FinalizeRevision(ctx context.Context, db DBTX, tenantID, id, newHash string, now time.Time) (int, string, error)
	DeleteApplication(ctx context.Context, db DBTX, tenantID, id string) error
	UpsertRunbookLink(ctx context.Context, db DBTX, tenantID, appID, runbookID string, sourceRev int, sourceHash string, now time.Time) error
	GetRunbookLink(ctx context.Context, db DBTX, appID, runbookID string) (*RunbookLink, error)
}

// txRunner runs a function inside a tenant-scoped transaction (RLS sees the
// tenant). Mutating operations use RunWithTenant; reads use RunReadWithTenant.
type txRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
}

// PGXRunner adapts a *pgxpool.Pool to txRunner using the platform's tenant
// transaction helpers, mirroring the recover/registry/runbookstudio runners.
type PGXRunner struct {
	Pool *pgxpool.Pool
}

// RunWithTenant runs fn in a read-write tenant transaction.
func (r PGXRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	if r.Pool == nil {
		return errors.New("metastore: nil transaction pool")
	}
	return database.RunWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunReadWithTenant runs fn in a read-only tenant transaction.
func (r PGXRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	if r.Pool == nil {
		return errors.New("metastore: nil transaction pool")
	}
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

var _ txRunner = PGXRunner{}

// DefaultRegistry is the complete, persistence-backed default implementation of
// MetastoreClient: a real CMDB-like Application Metastore over its six owned
// tables. It validates and persists application metadata, advances a metadata
// revision/fingerprint on every drift-relevant change, and (via the populator)
// drives the existing Runbook Studio to materialize runbooks from that metadata.
// It owns NO recovery logic — it is the source-of-truth registry and a
// composition point.
type DefaultRegistry struct {
	store   storeAPI
	runner  txRunner
	now     func() time.Time
	logger  zerolog.Logger
	metrics *Metrics
}

// Config wires a DefaultRegistry.
type Config struct {
	// Store persists the metastore tables; required.
	Store storeAPI
	// Runner runs tenant-scoped transactions; required.
	Runner txRunner
	// Metrics records registry observability; optional (a nil-safe no-op when unset).
	Metrics *Metrics
	// Logger is the structured logger; required.
	Logger zerolog.Logger
	// Now is injectable for deterministic tests; defaults to time.Now().UTC().
	Now func() time.Time
}

// NewDefaultRegistry validates the config and constructs the registry.
func NewDefaultRegistry(cfg Config) (*DefaultRegistry, error) {
	if cfg.Store == nil {
		return nil, errors.New("metastore registry: store is required")
	}
	if cfg.Runner == nil {
		return nil, errors.New("metastore registry: runner is required")
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &DefaultRegistry{
		store:   cfg.Store,
		runner:  cfg.Runner,
		now:     now,
		logger:  cfg.Logger.With().Str("component", "metastore").Logger(),
		metrics: cfg.Metrics,
	}, nil
}

// ResolveApplication returns the full metadata for one application by id.
func (r *DefaultRegistry) ResolveApplication(ctx context.Context, tenantID uuid.UUID, id string) (*Application, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("metastore: tenant id is required")
	}
	var app *Application
	err := r.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		var rerr error
		app, rerr = r.store.GetApplicationByID(ctx, db, tenantID.String(), id)
		return rerr
	})
	if err != nil {
		return nil, err
	}
	return app, nil
}

// ResolveApplicationByKey returns the full metadata for one application by its
// stable app_key.
func (r *DefaultRegistry) ResolveApplicationByKey(ctx context.Context, tenantID uuid.UUID, appKey string) (*Application, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("metastore: tenant id is required")
	}
	var app *Application
	err := r.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		var rerr error
		app, rerr = r.store.GetApplicationByKey(ctx, db, tenantID.String(), appKey)
		return rerr
	})
	if err != nil {
		return nil, err
	}
	return app, nil
}

// ListApplications returns a bounded page of the tenant's applications.
func (r *DefaultRegistry) ListApplications(ctx context.Context, tenantID uuid.UUID, limit, offset int) (ListPage, error) {
	if tenantID == uuid.Nil {
		return ListPage{}, errors.New("metastore: tenant id is required")
	}
	if limit <= 0 {
		limit = 25
	}
	if offset < 0 {
		offset = 0
	}
	var page ListPage
	err := r.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		var rerr error
		page, rerr = r.store.ListApplications(ctx, db, tenantID.String(), limit, offset)
		return rerr
	})
	if err != nil {
		return ListPage{}, err
	}
	return page, nil
}

// CreateApplication registers a new application: validate, insert the scalar
// row, write the children, finalize the metadata fingerprint — all in ONE
// tenant transaction so a partial registration never lands.
func (r *DefaultRegistry) CreateApplication(ctx context.Context, tenantID uuid.UUID, in ApplicationInput) (*Application, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("metastore: tenant id is required")
	}
	app, err := validateInput(tenantID.String(), in)
	if err != nil {
		return nil, err
	}

	now := r.now()
	var out *Application
	err = r.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		id, ierr := r.store.InsertApplication(ctx, db, tenantID.String(), app, now)
		if ierr != nil {
			return ierr
		}
		app.ID = id
		if cerr := r.store.ReplaceChildren(ctx, db, tenantID.String(), id, app); cerr != nil {
			return cerr
		}
		hash := MetadataHash(app)
		rev, storedHash, ferr := r.store.FinalizeRevision(ctx, db, tenantID.String(), id, hash, now)
		if ferr != nil {
			return ferr
		}
		app.MetadataRevision = rev
		app.MetadataHash = storedHash
		// Re-read so the returned value carries server-assigned ids/timestamps and
		// the canonical child ordering.
		var rerr error
		out, rerr = r.store.GetApplicationByID(ctx, db, tenantID.String(), id)
		return rerr
	})
	if err != nil {
		return nil, err
	}
	r.metrics.observeApplicationWrite("create")
	r.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("app_key", out.AppKey).
		Str("application_id", out.ID).
		Int("metadata_revision", out.MetadataRevision).
		Msg("metastore application registered")
	return out, nil
}

// UpdateApplication replaces an application's metadata wholesale and advances
// the revision only when the drift-relevant fingerprint changed. The scalar
// update, child replacement, and fingerprint finalize run in ONE transaction.
func (r *DefaultRegistry) UpdateApplication(ctx context.Context, tenantID uuid.UUID, id string, in ApplicationInput) (*Application, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("metastore: tenant id is required")
	}
	app, err := validateInput(tenantID.String(), in)
	if err != nil {
		return nil, err
	}
	app.ID = id

	now := r.now()
	var out *Application
	err = r.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		// Confirm the application exists (and app_key is unchanged: app_key is the
		// immutable stable identity, so an update keeps the existing key).
		existing, gerr := r.store.GetApplicationByID(ctx, db, tenantID.String(), id)
		if gerr != nil {
			return gerr
		}
		app.AppKey = existing.AppKey
		if uerr := r.store.UpdateApplicationScalars(ctx, db, tenantID.String(), id, app, now); uerr != nil {
			return uerr
		}
		if cerr := r.store.ReplaceChildren(ctx, db, tenantID.String(), id, app); cerr != nil {
			return cerr
		}
		hash := MetadataHash(app)
		rev, storedHash, ferr := r.store.FinalizeRevision(ctx, db, tenantID.String(), id, hash, now)
		if ferr != nil {
			return ferr
		}
		app.MetadataRevision = rev
		app.MetadataHash = storedHash
		var rerr error
		out, rerr = r.store.GetApplicationByID(ctx, db, tenantID.String(), id)
		return rerr
	})
	if err != nil {
		return nil, err
	}
	r.metrics.observeApplicationWrite("update")
	r.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("application_id", out.ID).
		Int("metadata_revision", out.MetadataRevision).
		Msg("metastore application updated")
	return out, nil
}

// DeleteApplication removes an application and its children/links.
func (r *DefaultRegistry) DeleteApplication(ctx context.Context, tenantID uuid.UUID, id string) error {
	if tenantID == uuid.Nil {
		return errors.New("metastore: tenant id is required")
	}
	err := r.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		return r.store.DeleteApplication(ctx, db, tenantID.String(), id)
	})
	if err != nil {
		return err
	}
	r.metrics.observeApplicationWrite("delete")
	r.logger.Info().Str("tenant_id", tenantID.String()).Str("application_id", id).Msg("metastore application deleted")
	return nil
}

// validateInput validates and normalizes a create/update payload into an
// Application shell (children attached, server fields blank). It rejects an
// empty/over-long app_key/name, an unknown tier, a negative RTO, an unknown
// environment kind / dependency criticality / cloud provider, and a
// self-dependency. Returns ErrInvalid wrapping the specific reason.
func validateInput(tenantID string, in ApplicationInput) (Application, error) {
	appKey := strings.TrimSpace(in.AppKey)
	name := strings.TrimSpace(in.Name)
	if appKey == "" || len(appKey) > 128 {
		return Application{}, fmt.Errorf("%w: app_key must be 1..128 chars", ErrInvalid)
	}
	if name == "" || len(name) > 256 {
		return Application{}, fmt.Errorf("%w: name must be 1..256 chars", ErrInvalid)
	}
	tier := in.RecoveryTier
	if tier == "" {
		tier = TierThree
	}
	if !ValidTier(tier) {
		return Application{}, fmt.Errorf("%w: unknown recovery_tier %q", ErrInvalid, tier)
	}
	if in.RTOTargetSeconds < 0 {
		return Application{}, fmt.Errorf("%w: rto_target_seconds must be >= 0", ErrInvalid)
	}

	envKeys := map[string]bool{}
	for _, e := range in.Environments {
		ek := strings.TrimSpace(e.Key)
		if ek == "" || len(ek) > 64 {
			return Application{}, fmt.Errorf("%w: environment key must be 1..64 chars", ErrInvalid)
		}
		if envKeys[ek] {
			return Application{}, fmt.Errorf("%w: duplicate environment key %q", ErrInvalid, ek)
		}
		envKeys[ek] = true
		kind := e.Kind
		if kind == "" {
			kind = EnvProduction
		}
		if !ValidEnvKind(kind) {
			return Application{}, fmt.Errorf("%w: unknown environment kind %q", ErrInvalid, kind)
		}
	}

	for _, o := range in.Owners {
		if strings.TrimSpace(o.Role) == "" || strings.TrimSpace(o.Name) == "" {
			return Application{}, fmt.Errorf("%w: owner role and name are required", ErrInvalid)
		}
	}

	depKeys := map[string]bool{}
	for _, d := range in.Dependencies {
		dk := strings.TrimSpace(d.DependsOnAppKey)
		if dk == "" {
			return Application{}, fmt.Errorf("%w: dependency app_key is required", ErrInvalid)
		}
		if dk == appKey {
			return Application{}, fmt.Errorf("%w: application cannot depend on itself", ErrInvalid)
		}
		if depKeys[dk] {
			return Application{}, fmt.Errorf("%w: duplicate dependency %q", ErrInvalid, dk)
		}
		depKeys[dk] = true
		crit := d.Criticality
		if crit == "" {
			crit = DependencyHard
		}
		if !ValidDependencyCriticality(crit) {
			return Application{}, fmt.Errorf("%w: unknown dependency criticality %q", ErrInvalid, crit)
		}
	}

	for _, a := range in.CloudAccounts {
		if !ValidProvider(a.Provider) {
			return Application{}, fmt.Errorf("%w: unknown cloud provider %q", ErrInvalid, a.Provider)
		}
		if strings.TrimSpace(a.AccountRef) == "" {
			return Application{}, fmt.Errorf("%w: cloud account_ref is required", ErrInvalid)
		}
	}

	// Normalize defaults onto the child sets.
	owners := append([]Owner(nil), in.Owners...)
	envs := make([]Environment, len(in.Environments))
	for i, e := range in.Environments {
		e.Key = strings.TrimSpace(e.Key)
		if e.Kind == "" {
			e.Kind = EnvProduction
		}
		envs[i] = e
	}
	deps := make([]Dependency, len(in.Dependencies))
	for i, d := range in.Dependencies {
		d.DependsOnAppKey = strings.TrimSpace(d.DependsOnAppKey)
		if d.Criticality == "" {
			d.Criticality = DependencyHard
		}
		deps[i] = d
	}
	accounts := append([]CloudAccount(nil), in.CloudAccounts...)

	return Application{
		TenantID:         tenantID,
		AppKey:           appKey,
		Name:             name,
		Description:      strings.TrimSpace(in.Description),
		RecoveryTier:     tier,
		RTOTargetSeconds: in.RTOTargetSeconds,
		Owners:           owners,
		Environments:     envs,
		Dependencies:     deps,
		CloudAccounts:    accounts,
	}, nil
}

// compile-time check that the SQL store satisfies storeAPI.
var _ storeAPI = (*Store)(nil)
var _ = repository.DBTX(nil)
