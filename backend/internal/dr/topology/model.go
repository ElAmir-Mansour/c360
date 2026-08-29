// Package topology implements ClarioDR capability #10 — multi-site / cascading
// replication topology (DESIGN_DataStream_DR.md §2.1 "topology", §6.3 recovery
// executor, §11 SLO metrics). The single source->target pair the rest of the DR
// service assumes is generalised here to a DIRECTED ACYCLIC GRAPH of sites: one
// source can fan out to N DR targets (1-to-many), and chains can cascade
// (A->B->C, where B is both a relay target of A and the source of C).
//
// The package owns a real graph engine — not a model wrapper:
//
//   - AddEdge rejects any edge that would introduce a cycle (DFS three-colour
//     reachability test, graph.go), so the topology is always a DAG and a
//     failover can never loop.
//   - TopoSort produces a deterministic apply/boot order over the DAG and is the
//     validation that the graph is acyclic.
//   - ReachableTargets(source) walks the DAG to the set of leaf/target sites a
//     given source replicates to (directly or through relays).
//   - SelectFailoverTarget(group) ranks the eligible targets by a real,
//     deterministic key — (state eligibility, replication lag, edge priority,
//     freshness) — and returns the winner plus the full ranking rationale, so the
//     §6 gated failover knows which standby to promote.
//
// Per-edge health/lag is rolled up from the SAME datastream.dr.progress
// telemetry the RPO monitor consumes (consumer.go): each progress sample for a
// stream updates every edge that carries that stream, so the ranking reflects
// live replication health rather than a static config.
//
// Disjoint ownership: this package defines its OWN model types, its OWN store
// over repository.DBTX (raw queries; it does NOT edit the shared repository),
// its OWN chi.Router, its OWN background consumer, and its OWN migration pair
// (000015). It reuses internal/datastream/core (Frame/Progress), the
// repository.DBTX execution-context pattern, and internal/events + outbox.
package topology

import (
	"errors"
	"time"
)

// Sentinel errors mapped to HTTP statuses by the router.
var (
	// ErrGroupNotFound is returned when the consistency group is absent.
	ErrGroupNotFound = errors.New("consistency group not found")
	// ErrNodeNotFound is returned when an edge references a missing topology node.
	ErrNodeNotFound = errors.New("topology node not found")
	// ErrCycle is returned by AddEdge / the service when adding an edge would
	// create a cycle in the directed graph. The router maps it to HTTP 409.
	ErrCycle = errors.New("edge would create a cycle in the replication topology")
	// ErrSelfEdge is returned when from_node == to_node.
	ErrSelfEdge = errors.New("a topology edge cannot connect a node to itself")
	// ErrEdgeExists is returned when an identical (from,to) edge already exists.
	ErrEdgeExists = errors.New("topology edge already exists")
	// ErrInvalidRole is returned when a node role is not source/relay/target.
	ErrInvalidRole = errors.New("invalid topology node role")
	// ErrInvalidMode is returned when an edge mode is not sync/async.
	ErrInvalidMode = errors.New("invalid replication edge mode")
)

// Node roles within a topology group. A site can be a SOURCE (origin of
// replication, never a failover target), a RELAY (both a downstream target of a
// source AND an upstream source of further targets — the middle of a cascade),
// or a TARGET (a terminal standby that can be promoted on failover).
const (
	RoleSource = "source"
	RoleRelay  = "relay"
	RoleTarget = "target"
)

// Edge replication modes.
const (
	ModeSync  = "sync"
	ModeAsync = "async"
)

// Edge health states, rolled up from datastream.dr.progress telemetry. The
// ordering (healthy < degraded < unhealthy < unknown) is used by the ranking.
const (
	// HealthHealthy means the edge's stream is applying within objective.
	HealthHealthy = "healthy"
	// HealthDegraded means lag exceeds objective but the stream is still applying.
	HealthDegraded = "degraded"
	// HealthUnhealthy means no recent progress / the stream is in error.
	HealthUnhealthy = "unhealthy"
	// HealthUnknown means no progress sample has ever been observed for the edge.
	HealthUnknown = "unknown"
)

// ValidRole reports whether r is a recognised node role.
func ValidRole(r string) bool {
	return r == RoleSource || r == RoleRelay || r == RoleTarget
}

// ValidMode reports whether m is a recognised edge mode.
func ValidMode(m string) bool {
	return m == ModeSync || m == ModeAsync
}

// Node is one site participating in a group's replication topology — a vertex of
// the directed graph. The same protected_site can appear in at most one node per
// group (UNIQUE (group_id, site_id)).
type Node struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenant_id"`
	GroupID   string    `json:"group_id"`
	SiteID    string    `json:"site_id"`
	SiteName  string    `json:"site_name"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// IsPromotable reports whether a node may be selected as a failover target. A
// pure SOURCE is never promotable (promoting the origin is a no-op); RELAY and
// TARGET nodes are promotable standbys.
func (n Node) IsPromotable() bool {
	return n.Role == RoleRelay || n.Role == RoleTarget
}

// Edge is a directed replication link from_node -> to_node carrying one stream.
// It records the mode (sync/async), a selection priority (lower wins, like a
// preference list), and the live health rollup (state, lag, last-progress time)
// the consumer maintains from datastream.dr.progress.
type Edge struct {
	ID         string `json:"id"`
	TenantID   string `json:"tenant_id"`
	GroupID    string `json:"group_id"`
	FromNodeID string `json:"from_node_id"`
	ToNodeID   string `json:"to_node_id"`
	// StreamID is the replication_stream the edge carries (the core's StreamID).
	// It is the join key from datastream.dr.progress to this edge.
	StreamID string `json:"stream_id"`
	Mode     string `json:"mode"`
	// Priority orders candidate targets when health and lag tie; LOWER is
	// preferred (1 = most preferred standby).
	Priority int `json:"priority"`
	// Health is the rolled-up edge health (HealthHealthy/.../HealthUnknown).
	Health string `json:"health"`
	// LagSeconds is the most recent replication lag rolled up from progress
	// telemetry (now - Frame.EmittedAt at apply). Nil before any sample.
	LagSeconds *int64 `json:"lag_seconds,omitempty"`
	// AppliedSeq is the highest contiguously-applied Seq last seen for the stream.
	AppliedSeq int64 `json:"applied_seq"`
	// LastProgressAt is the wall clock of the last progress sample, nil before any.
	LastProgressAt *time.Time `json:"last_progress_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// healthRank maps a health state to a sortable rank (lower is better).
func healthRank(h string) int {
	switch h {
	case HealthHealthy:
		return 0
	case HealthDegraded:
		return 1
	case HealthUnhealthy:
		return 2
	default: // HealthUnknown or unrecognised
		return 3
	}
}

// Topology is the full directed graph of a group: its nodes and edges. It is the
// payload returned by GET /groups/{id}/topology and the input the graph
// algorithms operate on.
type Topology struct {
	GroupID string `json:"group_id"`
	Nodes   []Node `json:"nodes"`
	Edges   []Edge `json:"edges"`
}

// NodeByID returns the node with the given id, or false.
func (t Topology) NodeByID(id string) (Node, bool) {
	for _, n := range t.Nodes {
		if n.ID == id {
			return n, true
		}
	}
	return Node{}, false
}

// FailoverCandidate is one ranked promotion candidate in a SelectFailoverTarget
// result. The fields are the exact ranking key, surfaced so the API caller (and
// the audit trail) can see WHY a target was chosen over another.
type FailoverCandidate struct {
	NodeID     string `json:"node_id"`
	SiteID     string `json:"site_id"`
	SiteName   string `json:"site_name"`
	Role       string `json:"role"`
	EdgeID     string `json:"edge_id"`
	StreamID   string `json:"stream_id"`
	Mode       string `json:"mode"`
	Priority   int    `json:"priority"`
	Health     string `json:"health"`
	Eligible   bool   `json:"eligible"`
	LagSeconds *int64 `json:"lag_seconds,omitempty"`
	AppliedSeq int64  `json:"applied_seq"`
	// Reason explains eligibility (or why the candidate was skipped).
	Reason string `json:"reason"`
}

// FailoverSelection is the result of SelectFailoverTarget: the chosen target
// (nil when none is eligible) and the full ranking of every considered
// candidate, best first, so the decision is explainable and auditable.
type FailoverSelection struct {
	GroupID     string              `json:"group_id"`
	Selected    *FailoverCandidate  `json:"selected"`
	Ranking     []FailoverCandidate `json:"ranking"`
	EvaluatedAt time.Time           `json:"evaluated_at"`
}
