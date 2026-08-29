package topology

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/repository"
)

// DBTX is re-exported from the shared repository so the store, the service, and
// the consumer all speak the same execution-context type: a *pgxpool.Pool for a
// single read, or the caller's open transaction so a topology write commits
// atomically with its outbox event. This package adds its OWN read/write methods
// for its two owned tables via raw queries rather than editing the shared
// repository (the prompt explicitly permits this).
type DBTX = repository.DBTX

// Store persists the replication topology (its two owned tables —
// dr_topology_node and dr_topology_edge) and reads the consistency group +
// protected sites the topology is built over. It holds no state; the caller
// chooses the DBTX, so a request reads/writes under a tenant transaction and the
// health-rollup consumer reads/writes under a system (RLS-bypass) transaction.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

// GroupName returns the consistency group's name (scoped by the DBTX's RLS
// context) or ErrGroupNotFound.
func (s *Store) GroupName(ctx context.Context, db DBTX, groupID string) (string, error) {
	var name string
	err := db.QueryRow(ctx, `SELECT name FROM consistency_group WHERE id = $1`, groupID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("group %s: %w", groupID, ErrGroupNotFound)
	}
	if err != nil {
		return "", fmt.Errorf("topology: reading group %s: %w", groupID, err)
	}
	return name, nil
}

// ---------------------------------------------------------------------------
// Node persistence (dr_topology_node).
// ---------------------------------------------------------------------------

// EnsureNode returns the existing topology node for (group, site), creating it
// with the given role if absent. It is the idempotent way the service binds a
// protected site into a group's topology before an edge can reference it. A lost
// create race (unique violation on (group_id, site_id)) re-reads the winner.
func (s *Store) EnsureNode(ctx context.Context, db DBTX, tenantID, groupID, siteID, role string) (*Node, error) {
	if !ValidRole(role) {
		return nil, fmt.Errorf("%q: %w", role, ErrInvalidRole)
	}
	existing, err := s.getNodeBySite(ctx, db, groupID, siteID)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, ErrNodeNotFound) {
		return nil, err
	}

	var n Node
	err = db.QueryRow(ctx, `
		INSERT INTO dr_topology_node (tenant_id, group_id, site_id, role)
		VALUES ($1, $2, $3, $4)
		RETURNING id, tenant_id, group_id, site_id, role, created_at, updated_at`,
		tenantID, groupID, siteID, role,
	).Scan(&n.ID, &n.TenantID, &n.GroupID, &n.SiteID, &n.Role, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return s.getNodeBySite(ctx, db, groupID, siteID)
		}
		if isForeignKeyViolation(err) {
			return nil, fmt.Errorf("topology: site %s not in group %s: %w", siteID, groupID, ErrNodeNotFound)
		}
		return nil, fmt.Errorf("topology: creating node for site %s in group %s: %w", siteID, groupID, err)
	}
	return &n, nil
}

// GetNode returns a node by ID (RLS-scoped) or ErrNodeNotFound.
func (s *Store) GetNode(ctx context.Context, db DBTX, nodeID string) (*Node, error) {
	var n Node
	err := db.QueryRow(ctx, `
		SELECT id, tenant_id, group_id, site_id, role, created_at, updated_at
		  FROM dr_topology_node WHERE id = $1`, nodeID,
	).Scan(&n.ID, &n.TenantID, &n.GroupID, &n.SiteID, &n.Role, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("node %s: %w", nodeID, ErrNodeNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("topology: reading node %s: %w", nodeID, err)
	}
	return &n, nil
}

func (s *Store) getNodeBySite(ctx context.Context, db DBTX, groupID, siteID string) (*Node, error) {
	var n Node
	err := db.QueryRow(ctx, `
		SELECT id, tenant_id, group_id, site_id, role, created_at, updated_at
		  FROM dr_topology_node WHERE group_id = $1 AND site_id = $2`, groupID, siteID,
	).Scan(&n.ID, &n.TenantID, &n.GroupID, &n.SiteID, &n.Role, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("site %s in group %s: %w", siteID, groupID, ErrNodeNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("topology: reading node for site %s in group %s: %w", siteID, groupID, err)
	}
	return &n, nil
}

// ---------------------------------------------------------------------------
// Edge persistence (dr_topology_edge).
// ---------------------------------------------------------------------------

// InsertEdge appends a directed replication edge. The caller MUST have verified
// the edge does not create a cycle (the service does so inside the same
// transaction after locking the group's edges). A duplicate (from,to) edge maps
// to ErrEdgeExists; a missing node endpoint maps to ErrNodeNotFound.
func (s *Store) InsertEdge(ctx context.Context, db DBTX, e *Edge) (*Edge, error) {
	if !ValidMode(e.Mode) {
		return nil, fmt.Errorf("%q: %w", e.Mode, ErrInvalidMode)
	}
	var stored Edge
	err := db.QueryRow(ctx, `
		INSERT INTO dr_topology_edge
		    (tenant_id, group_id, from_node_id, to_node_id, stream_id, mode, priority, health)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, tenant_id, group_id, from_node_id, to_node_id, stream_id, mode,
		          priority, health, lag_seconds, applied_seq, last_progress_at, created_at, updated_at`,
		e.TenantID, e.GroupID, e.FromNodeID, e.ToNodeID, e.StreamID, e.Mode, e.Priority, HealthUnknown,
	).Scan(&stored.ID, &stored.TenantID, &stored.GroupID, &stored.FromNodeID, &stored.ToNodeID,
		&stored.StreamID, &stored.Mode, &stored.Priority, &stored.Health, &stored.LagSeconds,
		&stored.AppliedSeq, &stored.LastProgressAt, &stored.CreatedAt, &stored.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrEdgeExists
		}
		if isForeignKeyViolation(err) {
			return nil, ErrNodeNotFound
		}
		return nil, fmt.Errorf("topology: inserting edge %s->%s: %w", e.FromNodeID, e.ToNodeID, err)
	}
	return &stored, nil
}

// LoadTopology reads the full directed graph for a group: every node and every
// edge, ordered deterministically. It returns ErrGroupNotFound if the group is
// absent. The returned Topology is the input the graph algorithms operate on and
// the payload GET /groups/{id}/topology returns.
func (s *Store) LoadTopology(ctx context.Context, db DBTX, groupID string) (Topology, error) {
	if _, err := s.GroupName(ctx, db, groupID); err != nil {
		return Topology{}, err
	}
	t := Topology{GroupID: groupID}

	// Nodes, joined to the protected site for the human-readable name.
	nodeRows, err := db.Query(ctx, `
		SELECT n.id, n.tenant_id, n.group_id, n.site_id, COALESCE(ps.name, ''), n.role,
		       n.created_at, n.updated_at
		  FROM dr_topology_node n
		  LEFT JOIN protected_site ps ON ps.id = n.site_id
		 WHERE n.group_id = $1
		 ORDER BY n.id ASC`, groupID)
	if err != nil {
		return Topology{}, fmt.Errorf("topology: reading nodes of group %s: %w", groupID, err)
	}
	defer nodeRows.Close()
	for nodeRows.Next() {
		var n Node
		if err := nodeRows.Scan(&n.ID, &n.TenantID, &n.GroupID, &n.SiteID, &n.SiteName, &n.Role,
			&n.CreatedAt, &n.UpdatedAt); err != nil {
			return Topology{}, fmt.Errorf("topology: scanning node of group %s: %w", groupID, err)
		}
		t.Nodes = append(t.Nodes, n)
	}
	if err := nodeRows.Err(); err != nil {
		return Topology{}, fmt.Errorf("topology: iterating nodes of group %s: %w", groupID, err)
	}

	edgeRows, err := db.Query(ctx, `
		SELECT id, tenant_id, group_id, from_node_id, to_node_id, stream_id, mode,
		       priority, health, lag_seconds, applied_seq, last_progress_at, created_at, updated_at
		  FROM dr_topology_edge
		 WHERE group_id = $1
		 ORDER BY priority ASC, id ASC`, groupID)
	if err != nil {
		return Topology{}, fmt.Errorf("topology: reading edges of group %s: %w", groupID, err)
	}
	defer edgeRows.Close()
	for edgeRows.Next() {
		e, serr := scanEdge(edgeRows)
		if serr != nil {
			return Topology{}, serr
		}
		t.Edges = append(t.Edges, *e)
	}
	if err := edgeRows.Err(); err != nil {
		return Topology{}, fmt.Errorf("topology: iterating edges of group %s: %w", groupID, err)
	}
	return t, nil
}

// LoadEdgesForLock reads a group's edges FOR UPDATE so the cycle check and the
// subsequent insert are serialised against a concurrent edge add to the same
// group — two simultaneous adds cannot each see a graph without the other's edge
// and both pass the cycle check. It is called inside the service's write
// transaction. The nodes are read without locking (the cycle test only needs the
// current edge set; nodes do not change a reachability answer).
func (s *Store) LoadEdgesForLock(ctx context.Context, db DBTX, groupID string) ([]Edge, error) {
	rows, err := db.Query(ctx, `
		SELECT id, tenant_id, group_id, from_node_id, to_node_id, stream_id, mode,
		       priority, health, lag_seconds, applied_seq, last_progress_at, created_at, updated_at
		  FROM dr_topology_edge
		 WHERE group_id = $1
		 ORDER BY id ASC
		 FOR UPDATE`, groupID)
	if err != nil {
		return nil, fmt.Errorf("topology: locking edges of group %s: %w", groupID, err)
	}
	defer rows.Close()
	var out []Edge
	for rows.Next() {
		e, serr := scanEdge(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, *e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("topology: iterating locked edges of group %s: %w", groupID, err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Health rollup (consumed from datastream.dr.progress).
// ---------------------------------------------------------------------------

// HealthUpdate is the rolled-up edge health one progress sample produces.
type HealthUpdate struct {
	Health         string
	LagSeconds     int64
	AppliedSeq     int64
	LastProgressAt time.Time
}

// UpdateEdgeHealthByStream applies a health rollup to EVERY edge carrying the
// given stream (a stream may be carried by more than one edge in a fan-out where
// the same source replicates the same stream to multiple targets). It is
// monotonic on applied_seq: a stale/out-of-order progress sample (applied_seq
// not greater than the stored one) does not regress the last-progress time, but
// the health/lag are always refreshed because they reflect the latest
// observation. Returns the number of edges updated (0 = no edge carries the
// stream, which the consumer treats as a benign skip).
func (s *Store) UpdateEdgeHealthByStream(ctx context.Context, db DBTX, streamID string, u HealthUpdate) (int64, error) {
	tag, err := db.Exec(ctx, `
		UPDATE dr_topology_edge
		   SET health = $2,
		       lag_seconds = $3,
		       applied_seq = GREATEST(applied_seq, $4),
		       last_progress_at = GREATEST(COALESCE(last_progress_at, $5), $5),
		       updated_at = now()
		 WHERE stream_id = $1`,
		streamID, u.Health, u.LagSeconds, u.AppliedSeq, u.LastProgressAt)
	if err != nil {
		return 0, fmt.Errorf("topology: updating edge health for stream %s: %w", streamID, err)
	}
	return tag.RowsAffected(), nil
}

// ---------------------------------------------------------------------------
// Drill-scope reachability overlay (dr_drill_site_block) — the game-day
// block_site fault. This is the REAL observation path the block drives: it flips
// the blocked site's edges to 'unhealthy' so the topology-aware failover
// selection (graph.SelectFailoverTarget) treats the site as ineligible and the
// topology_degraded signal genuinely fires — never a production network change.
// ---------------------------------------------------------------------------

// ErrSiteNotFound is returned when a reachability block targets a site that does
// not exist, so the game-day block_site fault fails honestly.
var ErrSiteNotFound = errors.New("topology: protected site not found")

// edgeHealthSnapshot records one edge's pre-block health so the revert restores
// the EXACT prior state. Its JSON tags match the jsonb_to_recordset columns the
// restore reads.
type edgeHealthSnapshot struct {
	EdgeID     string `json:"edge_id"`
	PrevHealth string `json:"prev_health"`
}

const selectSiteEdgesForBlockSQL = `
SELECT e.id, e.health
  FROM dr_topology_edge e
 WHERE EXISTS (
     SELECT 1 FROM dr_topology_node n
      WHERE n.site_id = $1 AND (n.id = e.from_node_id OR n.id = e.to_node_id)
 )
 FOR UPDATE`

// SystemBlockSite marks a site unreachable within the topology: it snapshots the
// current health of every edge touching the site, flips those edges to
// 'unhealthy', and records the snapshot in dr_drill_site_block so the revert can
// restore the exact prior health. Blocking a site with no topology edges records
// an empty marker and is a benign no-op for the graph. Returns ErrSiteNotFound
// when the site does not exist.
//
// SYSTEM PATH — game-day orchestrator only (leader singleton); bypasses tenant
// RLS by design (§7), like the health-rollup consumer that writes the same table.
func (s *Store) SystemBlockSite(ctx context.Context, db DBTX, siteID string) error {
	var tenantID string
	err := db.QueryRow(ctx, `SELECT tenant_id FROM protected_site WHERE id = $1`, siteID).Scan(&tenantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("site %s: %w", siteID, ErrSiteNotFound)
	}
	if err != nil {
		return fmt.Errorf("topology: resolving tenant for site %s: %w", siteID, err)
	}

	rows, err := db.Query(ctx, selectSiteEdgesForBlockSQL, siteID)
	if err != nil {
		return fmt.Errorf("topology: selecting edges to block for site %s: %w", siteID, err)
	}
	var snapshot []edgeHealthSnapshot
	var edgeIDs []string
	for rows.Next() {
		var snap edgeHealthSnapshot
		if serr := rows.Scan(&snap.EdgeID, &snap.PrevHealth); serr != nil {
			rows.Close()
			return fmt.Errorf("topology: scanning edge to block for site %s: %w", siteID, serr)
		}
		snapshot = append(snapshot, snap)
		edgeIDs = append(edgeIDs, snap.EdgeID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("topology: reading edges to block for site %s: %w", siteID, err)
	}

	if len(edgeIDs) > 0 {
		if _, err := db.Exec(ctx, `
			UPDATE dr_topology_edge
			   SET health = $2, updated_at = now()
			 WHERE id = ANY($1::uuid[])`,
			edgeIDs, HealthUnhealthy); err != nil {
			return fmt.Errorf("topology: blocking edges for site %s: %w", siteID, err)
		}
	}

	snapshotJSON, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("topology: marshaling block snapshot for site %s: %w", siteID, err)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO dr_drill_site_block (site_id, tenant_id, snapshot, blocked_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (site_id) DO UPDATE
		   SET snapshot = EXCLUDED.snapshot, blocked_at = now()`,
		siteID, tenantID, snapshotJSON); err != nil {
		return fmt.Errorf("topology: recording site block for %s: %w", siteID, err)
	}
	return nil
}

// SystemRestoreSite reverts a reachability block: it restores each edge to the
// exact health recorded when the site was blocked and deletes the block marker.
// It is the block_site fault's revert: idempotent (restoring an absent block is a
// no-op) so the orchestrator's exactly-once teardown is always safe to run.
//
// SYSTEM PATH — game-day orchestrator only (leader singleton); bypasses tenant
// RLS by design (§7).
func (s *Store) SystemRestoreSite(ctx context.Context, db DBTX, siteID string) error {
	var snapshotJSON []byte
	err := db.QueryRow(ctx, `SELECT snapshot FROM dr_drill_site_block WHERE site_id = $1`, siteID).Scan(&snapshotJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // nothing blocked; idempotent revert.
	}
	if err != nil {
		return fmt.Errorf("topology: reading site block for %s: %w", siteID, err)
	}

	if len(snapshotJSON) > 0 {
		if _, err := db.Exec(ctx, `
			UPDATE dr_topology_edge e
			   SET health = s.prev_health, updated_at = now()
			  FROM jsonb_to_recordset($1::jsonb) AS s(edge_id uuid, prev_health text)
			 WHERE e.id = s.edge_id`,
			snapshotJSON); err != nil {
			return fmt.Errorf("topology: restoring edges for site %s: %w", siteID, err)
		}
	}

	if _, err := db.Exec(ctx, `DELETE FROM dr_drill_site_block WHERE site_id = $1`, siteID); err != nil {
		return fmt.Errorf("topology: clearing site block for %s: %w", siteID, err)
	}
	return nil
}

func scanEdge(rows pgx.Rows) (*Edge, error) {
	var e Edge
	if err := rows.Scan(&e.ID, &e.TenantID, &e.GroupID, &e.FromNodeID, &e.ToNodeID, &e.StreamID,
		&e.Mode, &e.Priority, &e.Health, &e.LagSeconds, &e.AppliedSeq, &e.LastProgressAt,
		&e.CreatedAt, &e.UpdatedAt); err != nil {
		return nil, fmt.Errorf("topology: scanning edge: %w", err)
	}
	return &e, nil
}
