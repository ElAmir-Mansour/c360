package iacdr

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
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const eventSource = "clario-dr-service"

// Lifecycle event types this package stages on the existing datastream.dr.events
// topic (DESIGN §8). They are this package's OWN types so the other DR consumers
// (which filter by their own types) ignore them.
const (
	eventSnapshotIngested = "com.clario360.datastream.dr.iac.snapshot.ingested"
	eventDriftDetected    = "com.clario360.datastream.dr.iac.drift.detected"
)

// storeAPI is the persistence surface the service needs. *Store satisfies it;
// tests substitute an in-memory fake so the service's parse/version/diff/plan
// orchestration is exercised without a database.
type storeAPI interface {
	NextVersion(ctx context.Context, db DBTX, tenantID, name string) (int, error)
	InsertSnapshot(ctx context.Context, db DBTX, snap *Snapshot) (*Snapshot, error)
	InsertResources(ctx context.Context, db DBTX, tenantID, snapshotID string, resources []Resource) error
	GetSnapshot(ctx context.Context, db DBTX, snapshotID string) (*Snapshot, error)
	ListSnapshots(ctx context.Context, db DBTX, tenantID string) ([]Snapshot, error)
	LoadResources(ctx context.Context, db DBTX, snapshotID string) ([]Resource, error)
	GroupExists(ctx context.Context, db DBTX, groupID string) (bool, error)
}

// txRunner runs a function inside a tenant-scoped transaction.
type txRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
}

// PGXRunner adapts a *pgxpool.Pool to txRunner using the platform's tenant
// transaction helpers.
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

// eventStager stages a lifecycle event in the caller's transaction. The default
// implementation writes to the transactional outbox so the event commits
// atomically with the snapshot ingest.
type eventStager interface {
	Stage(ctx context.Context, tx DBTX, eventType, tenantID string, data map[string]any) error
}

type outboxStager struct{}

func (outboxStager) Stage(ctx context.Context, tx DBTX, eventType, tenantID string, data map[string]any) error {
	evt, err := events.NewEvent(eventType, eventSource, tenantID, data)
	if err != nil {
		return fmt.Errorf("iacdr: building %s event: %w", eventType, err)
	}
	return outbox.Write(ctx, tx, events.Topics.DREvents, evt)
}

// Service is the IaC-DR control-plane service: it ingests IaC artifacts through
// the real parsers, VERSIONS captured snapshots (content-hashed per snapshot and
// per resource), computes structured DRIFT DIFFS between snapshots, and builds
// topologically-ordered RECONSTITUTION PLANS. It owns no algorithms itself — the
// parsers, diff engine and planner are pure engines — it wires persistence,
// transactions, events, and those engines.
type Service struct {
	store   storeAPI
	runner  txRunner
	stager  eventStager
	metrics *Metrics
	parsers map[string]Parser
	now     func() time.Time
	logger  zerolog.Logger
}

// Config wires a Service.
type Config struct {
	Store  storeAPI
	Runner txRunner
	// Stager is optional; defaults to the transactional-outbox stager.
	Stager  eventStager
	Metrics *Metrics
	// Parsers is optional; defaults to the three real parsers (terraform state,
	// k8s manifest, helm release). Tests may inject a fake parser map.
	Parsers map[string]Parser
	// Now is optional; defaults to time.Now (UTC).
	Now    func() time.Time
	Logger zerolog.Logger
}

// NewService constructs a Service. Store and Runner are required.
func NewService(cfg Config) (*Service, error) {
	if cfg.Store == nil {
		return nil, errors.New("iacdr service: store is required")
	}
	if cfg.Runner == nil {
		return nil, errors.New("iacdr service: runner is required")
	}
	stager := cfg.Stager
	if stager == nil {
		stager = outboxStager{}
	}
	parsers := cfg.Parsers
	if parsers == nil {
		parsers = DefaultParsers()
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		store:   cfg.Store,
		runner:  cfg.Runner,
		stager:  stager,
		metrics: cfg.Metrics,
		parsers: parsers,
		now:     now,
		logger:  cfg.Logger,
	}, nil
}

// DefaultParsers returns the three real concrete parsers keyed by source kind.
func DefaultParsers() map[string]Parser {
	return map[string]Parser{
		SourceTerraformState: NewTerraformParser(),
		SourceK8sManifest:    NewK8sManifestParser(),
		SourceHelmRelease:    NewHelmReleaseParser(),
	}
}

// IngestRequest is the parsed POST /iac-snapshots input.
type IngestRequest struct {
	// Name is the estate/environment label the snapshot versions under.
	Name string
	// SourceKind selects the parser (terraform_state|k8s_manifest|helm_release).
	SourceKind string
	// Artifact is the raw IaC artifact bytes.
	Artifact []byte
	// GroupID optionally binds the snapshot to a consistency group.
	GroupID string
}

// Ingest parses an IaC artifact with the real parser for its source kind,
// VERSIONS the resulting snapshot (next version per estate name), persists the
// snapshot header + per-resource rows with content hashes, and stages a
// lifecycle event — all in ONE tenant transaction so the snapshot and its event
// commit atomically. It returns the stored snapshot with its resources.
func (s *Service) Ingest(ctx context.Context, tenantID uuid.UUID, req IngestRequest) (*Snapshot, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("name is required: %w", ErrInvalidRequest)
	}
	if !ValidSourceKind(req.SourceKind) {
		return nil, fmt.Errorf("%q: %w", req.SourceKind, ErrUnsupportedKind)
	}
	if len(req.Artifact) == 0 {
		return nil, fmt.Errorf("artifact is required: %w", ErrInvalidRequest)
	}
	parser, ok := s.parsers[req.SourceKind]
	if !ok {
		return nil, fmt.Errorf("%q: %w", req.SourceKind, ErrUnsupportedKind)
	}

	parsed, err := parser.Parse(req.Artifact)
	if err != nil {
		s.metrics.observeParseError(req.SourceKind)
		return nil, err
	}

	var groupID *string
	if g := strings.TrimSpace(req.GroupID); g != "" {
		groupID = &g
	}

	contentHash := ComputeContentHash(parsed.Resources)

	var stored *Snapshot
	err = s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if groupID != nil {
			exists, gerr := s.store.GroupExists(ctx, tx, *groupID)
			if gerr != nil {
				return gerr
			}
			if !exists {
				return fmt.Errorf("group %s does not exist: %w", *groupID, ErrInvalidRequest)
			}
		}
		version, verr := s.store.NextVersion(ctx, tx, tenantID.String(), name)
		if verr != nil {
			return verr
		}
		snap := &Snapshot{
			TenantID:      tenantID.String(),
			GroupID:       groupID,
			Name:          name,
			SourceKind:    parsed.SourceKind,
			Version:       version,
			ContentHash:   contentHash,
			ResourceCount: len(parsed.Resources),
			Metadata:      parsed.Metadata,
		}
		var serr error
		stored, serr = s.store.InsertSnapshot(ctx, tx, snap)
		if serr != nil {
			return serr
		}
		if ierr := s.store.InsertResources(ctx, tx, tenantID.String(), stored.ID, parsed.Resources); ierr != nil {
			return ierr
		}
		return s.stager.Stage(ctx, tx, eventSnapshotIngested, tenantID.String(), map[string]any{
			"snapshot_id":    stored.ID,
			"name":           stored.Name,
			"source_kind":    stored.SourceKind,
			"version":        stored.Version,
			"content_hash":   stored.ContentHash,
			"resource_count": stored.ResourceCount,
		})
	})
	if err != nil {
		return nil, err
	}
	s.metrics.observeIngested(parsed.SourceKind, len(parsed.Resources))

	stored.Resources = parsed.Resources
	return stored, nil
}

// GetSnapshot loads a snapshot with its resources under a read-only tenant tx.
func (s *Service) GetSnapshot(ctx context.Context, tenantID uuid.UUID, snapshotID string) (*Snapshot, error) {
	var snap *Snapshot
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var gerr error
		snap, gerr = s.store.GetSnapshot(ctx, tx, snapshotID)
		if gerr != nil {
			return gerr
		}
		resources, rerr := s.store.LoadResources(ctx, tx, snapshotID)
		if rerr != nil {
			return rerr
		}
		snap.Resources = resources
		return nil
	})
	if err != nil {
		return nil, err
	}
	return snap, nil
}

// ListSnapshots returns the tenant's snapshot headers (no resources), newest
// first.
func (s *Service) ListSnapshots(ctx context.Context, tenantID uuid.UUID) ([]Snapshot, error) {
	var out []Snapshot
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var lerr error
		out, lerr = s.store.ListSnapshots(ctx, tx, tenantID.String())
		return lerr
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Diff computes the structured drift between two snapshots (base -> target). It
// loads both snapshots' resources under one read-only tenant transaction (so a
// snapshot from another tenant cannot be diffed against) and runs the real diff
// engine. The base snapshot is the "against" parameter; the target is the
// snapshot being inspected.
func (s *Service) Diff(ctx context.Context, tenantID uuid.UUID, targetID, baseID string) (DiffResult, error) {
	var target, base *Snapshot
	var targetRes, baseRes []Resource
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var e error
		if target, e = s.store.GetSnapshot(ctx, tx, targetID); e != nil {
			return e
		}
		if targetRes, e = s.store.LoadResources(ctx, tx, targetID); e != nil {
			return e
		}
		if base, e = s.store.GetSnapshot(ctx, tx, baseID); e != nil {
			return e
		}
		if baseRes, e = s.store.LoadResources(ctx, tx, baseID); e != nil {
			return e
		}
		return nil
	})
	if err != nil {
		return DiffResult{}, err
	}

	diff := DiffSnapshots(baseRes, targetRes)
	diff.BaseSnapshotID = base.ID
	diff.TargetSnapshotID = target.ID
	added, removed, modified := diff.Summary()
	s.metrics.observeDiff(added, removed, modified)

	// Stage a drift event when there is drift (transactional outbox, own short tx).
	if diff.HasDrift() {
		if serr := s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
			return s.stager.Stage(ctx, tx, eventDriftDetected, tenantID.String(), map[string]any{
				"target_snapshot_id": target.ID,
				"base_snapshot_id":   base.ID,
				"added":              added,
				"removed":            removed,
				"modified":           modified,
			})
		}); serr != nil {
			s.logger.Warn().Err(serr).Msg("iacdr: staging drift event failed")
		}
	}
	return diff, nil
}

// ReconstitutionPlan loads a snapshot's resources and builds the
// topologically-ordered apply plan with cycle rejection.
func (s *Service) ReconstitutionPlan(ctx context.Context, tenantID uuid.UUID, snapshotID string) (ReconstitutionPlan, error) {
	var resources []Resource
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		// GetSnapshot first so a missing snapshot returns ErrSnapshotNotFound rather
		// than an empty plan.
		if _, gerr := s.store.GetSnapshot(ctx, tx, snapshotID); gerr != nil {
			return gerr
		}
		var rerr error
		resources, rerr = s.store.LoadResources(ctx, tx, snapshotID)
		return rerr
	})
	if err != nil {
		return ReconstitutionPlan{}, err
	}
	plan, perr := BuildReconstitutionPlan(resources)
	if perr != nil {
		if errors.Is(perr, ErrCycle) {
			s.metrics.observeCycleRejected()
		}
		return ReconstitutionPlan{}, perr
	}
	plan.SnapshotID = snapshotID
	s.metrics.observePlan()
	return plan, nil
}

// compile-time checks.
var (
	_ storeAPI    = (*Store)(nil)
	_ txRunner    = PGXRunner{}
	_ eventStager = outboxStager{}
	_ repository.DBTX
)
