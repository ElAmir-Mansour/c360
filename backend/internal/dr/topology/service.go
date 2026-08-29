package topology

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
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const eventSource = "clario-dr-service"

// Topic constant for the topology lifecycle/alert events this package stages.
// It reuses the existing datastream.dr.events topic (DESIGN §8). The two event
// types below are this package's own; the registry/runbook reconcile consumer
// filters by its own event types, so these do not trigger a runbook regen loop.
// eventEdgeAdded is staged when a topology edge is added (a topology change).
const eventEdgeAdded = "com.clario360.datastream.dr.topology.edge.added"

// storeAPI is the persistence surface the service needs. *Store satisfies it;
// tests substitute an in-memory fake so the service's cycle-rejection and
// selection logic is exercised without a database, while the integration path
// (and the graph-algorithm unit tests) use the real Store/Graph.
type storeAPI interface {
	GroupName(ctx context.Context, db DBTX, groupID string) (string, error)
	EnsureNode(ctx context.Context, db DBTX, tenantID, groupID, siteID, role string) (*Node, error)
	GetNode(ctx context.Context, db DBTX, nodeID string) (*Node, error)
	InsertEdge(ctx context.Context, db DBTX, e *Edge) (*Edge, error)
	LoadTopology(ctx context.Context, db DBTX, groupID string) (Topology, error)
	LoadEdgesForLock(ctx context.Context, db DBTX, groupID string) ([]Edge, error)
	UpdateEdgeHealthByStream(ctx context.Context, db DBTX, streamID string, u HealthUpdate) (int64, error)
}

// txRunner runs a function inside a tenant-scoped or system transaction. A
// request-path AddEdge commits the node/edge rows and the outbox event
// atomically under the caller's tenant; the health-rollup consumer uses
// RunSystem (cross-tenant) exactly like the registry generator.
type txRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunSystem(ctx context.Context, fn func(DBTX) error) error
	RunSystemRead(ctx context.Context, fn func(DBTX) error) error
}

// PGXRunner adapts a *pgxpool.Pool to txRunner using the platform's tenant and
// system transaction helpers (the single, clearly-named system path the design
// reserves for background loops, §7).
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
// atomically with the topology write.
type eventStager interface {
	Stage(ctx context.Context, tx DBTX, eventType, tenantID string, data map[string]any) error
}

type outboxStager struct{}

func (outboxStager) Stage(ctx context.Context, tx DBTX, eventType, tenantID string, data map[string]any) error {
	evt, err := events.NewEvent(eventType, eventSource, tenantID, data)
	if err != nil {
		return fmt.Errorf("topology: building %s event: %w", eventType, err)
	}
	return outbox.Write(ctx, tx, events.Topics.DREvents, evt)
}

// Service is the multi-site replication topology service: it manages the
// directed graph of a group's sites (nodes) and replication links (edges),
// enforcing the DAG invariant via cycle detection on every edge add, and selects
// a topology-aware failover target by ranking the live-health of the eligible
// standbys. It owns no graph algorithms itself — those live in graph.go as pure
// functions — it wires persistence, transactions, events, and the graph engine.
type Service struct {
	store   storeAPI
	runner  txRunner
	stager  eventStager
	metrics *Metrics
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
	// Now is optional; defaults to time.Now. Injected for deterministic tests.
	Now    func() time.Time
	Logger zerolog.Logger
}

// NewService constructs a Service. Store and Runner are required.
func NewService(cfg Config) (*Service, error) {
	if cfg.Store == nil {
		return nil, errors.New("topology service: store is required")
	}
	if cfg.Runner == nil {
		return nil, errors.New("topology service: runner is required")
	}
	stager := cfg.Stager
	if stager == nil {
		stager = outboxStager{}
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
		now:     now,
		logger:  cfg.Logger,
	}, nil
}

// AddEdgeInput is the request to add a directed replication edge between two
// sites of a group. The sites are bound into the topology as nodes (idempotently,
// with the supplied roles) if they are not already, then the edge is added —
// unless it would create a cycle, in which case ErrCycle is returned and nothing
// is written.
type AddEdgeInput struct {
	FromSiteID string
	ToSiteID   string
	// FromRole / ToRole are the roles to assign when binding the sites as nodes
	// for the first time. Defaults: FromRole=source, ToRole=target. A from-site
	// that is also a downstream target of another edge should be RoleRelay.
	FromRole string
	ToRole   string
	StreamID string
	Mode     string
	Priority int
}

func (in *AddEdgeInput) withDefaults() {
	if in.FromRole == "" {
		in.FromRole = RoleSource
	}
	if in.ToRole == "" {
		in.ToRole = RoleTarget
	}
	if in.Mode == "" {
		in.Mode = ModeAsync
	}
	if in.Priority == 0 {
		in.Priority = 100
	}
}

// AddEdge adds a directed replication edge to a group's topology after proving it
// does not create a cycle. The whole operation — bind nodes, lock the group's
// edges, run the cycle check over the graph-plus-proposed-edge, insert the edge,
// stage the lifecycle event — runs in ONE tenant transaction, so a rejected
// cycle leaves the topology untouched and a successful add publishes its event
// exactly once. ErrCycle is returned (and the tx rolled back) when the edge would
// close a loop; ErrSelfEdge when from==to; ErrEdgeExists on a duplicate.
func (s *Service) AddEdge(ctx context.Context, tenantID uuid.UUID, groupID string, in AddEdgeInput) (*Edge, error) {
	in.withDefaults()
	if in.FromSiteID == in.ToSiteID {
		return nil, ErrSelfEdge
	}
	if !ValidMode(in.Mode) {
		return nil, fmt.Errorf("%q: %w", in.Mode, ErrInvalidMode)
	}
	if !ValidRole(in.FromRole) || !ValidRole(in.ToRole) {
		return nil, ErrInvalidRole
	}

	var stored *Edge
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, gerr := s.store.GroupName(ctx, tx, groupID); gerr != nil {
			return gerr
		}

		fromNode, ferr := s.store.EnsureNode(ctx, tx, tenantID.String(), groupID, in.FromSiteID, in.FromRole)
		if ferr != nil {
			return ferr
		}
		toNode, terr := s.store.EnsureNode(ctx, tx, tenantID.String(), groupID, in.ToSiteID, in.ToRole)
		if terr != nil {
			return terr
		}

		// Lock the group's existing edges so a concurrent add to the same group is
		// serialised — two adds cannot each pass the cycle check against a graph
		// that omits the other's edge.
		edges, lerr := s.store.LoadEdgesForLock(ctx, tx, groupID)
		if lerr != nil {
			return lerr
		}

		// Build the current graph and test the proposed edge for a cycle. We supply
		// the two endpoint nodes explicitly and the full locked edge set; NewGraph
		// synthesises any intermediate relay node referenced by an edge but not in
		// the explicit list, so the reachability traversal follows the COMPLETE path
		// (e.g. for a proposed C->A it walks A->B->C and detects the loop).
		g := NewGraph(Topology{
			GroupID: groupID,
			Nodes:   []Node{*fromNode, *toNode},
			Edges:   edges,
		})
		if g.WouldCreateCycle(fromNode.ID, toNode.ID) {
			s.metrics.observeCycleRejected()
			return ErrCycle
		}

		edge := &Edge{
			TenantID:   tenantID.String(),
			GroupID:    groupID,
			FromNodeID: fromNode.ID,
			ToNodeID:   toNode.ID,
			StreamID:   in.StreamID,
			Mode:       in.Mode,
			Priority:   in.Priority,
		}
		var ierr error
		stored, ierr = s.store.InsertEdge(ctx, tx, edge)
		if ierr != nil {
			return ierr
		}

		return s.stager.Stage(ctx, tx, eventEdgeAdded, tenantID.String(), map[string]any{
			"group_id":     groupID,
			"edge_id":      stored.ID,
			"from_node_id": stored.FromNodeID,
			"to_node_id":   stored.ToNodeID,
			"stream_id":    stored.StreamID,
			"mode":         stored.Mode,
			"priority":     stored.Priority,
		})
	})
	if err != nil {
		return nil, err
	}
	s.metrics.observeEdgeAdded()
	return stored, nil
}

// GetTopology returns a group's full directed graph plus a deterministic
// topological order (the apply/boot sequence) under a read-only tenant
// transaction. ErrGroupNotFound when the group is absent.
func (s *Service) GetTopology(ctx context.Context, tenantID uuid.UUID, groupID string) (Topology, []string, error) {
	var t Topology
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var rerr error
		t, rerr = s.store.LoadTopology(ctx, tx, groupID)
		return rerr
	})
	if err != nil {
		return Topology{}, nil, err
	}
	order, _ := NewGraph(t).TopoSort()
	return t, order, nil
}

// SelectFailoverTarget loads a group's topology and returns the topology-aware
// failover target selection (the chosen standby + the full ranking rationale)
// under a read-only tenant transaction. The selection is computed by the pure
// graph engine over the live edge-health rollups.
func (s *Service) SelectFailoverTarget(ctx context.Context, tenantID uuid.UUID, groupID string) (FailoverSelection, error) {
	var t Topology
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var rerr error
		t, rerr = s.store.LoadTopology(ctx, tx, groupID)
		return rerr
	})
	if err != nil {
		return FailoverSelection{}, err
	}
	return NewGraph(t).SelectFailoverTarget(s.now()), nil
}

// applyHealthSystem applies an edge-health rollup for a stream under a system
// (RLS-bypass) transaction. It is the consumer's entry point: progress telemetry
// arrives across tenants, so the rollup cannot assume a single tenant context.
// The GREATEST-based monotonic update means an out-of-order sample never
// regresses applied_seq or last_progress_at. Returns the number of edges updated.
func (s *Service) applyHealthSystem(ctx context.Context, streamID string, u HealthUpdate) (int64, error) {
	var affected int64
	err := s.runner.RunSystem(ctx, func(tx DBTX) error {
		n, uerr := s.store.UpdateEdgeHealthByStream(ctx, tx, streamID, u)
		affected = n
		return uerr
	})
	if err != nil {
		s.metrics.observeRollupError()
		return 0, err
	}
	return affected, nil
}

// compile-time checks.
var (
	_ storeAPI    = (*Store)(nil)
	_ txRunner    = PGXRunner{}
	_ eventStager = outboxStager{}
	_ repository.DBTX
)
