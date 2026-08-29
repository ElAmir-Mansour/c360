package topology

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
)

const (
	tenantA = "aaaaaaaa-0000-0000-0000-000000000001"
	groupA  = "11111111-0000-0000-0000-000000000001"
)

func newMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func TestStore_GroupName(t *testing.T) {
	t.Parallel()
	t.Run("found", func(t *testing.T) {
		mock := newMock(t)
		mock.ExpectQuery(`SELECT name FROM consistency_group WHERE id = \$1`).
			WithArgs(groupA).
			WillReturnRows(pgxmock.NewRows([]string{"name"}).AddRow("prod-group"))
		name, err := NewStore().GroupName(context.Background(), mock, groupA)
		if err != nil {
			t.Fatalf("GroupName: %v", err)
		}
		if name != "prod-group" {
			t.Fatalf("name = %q, want prod-group", name)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("missing maps to ErrGroupNotFound", func(t *testing.T) {
		mock := newMock(t)
		mock.ExpectQuery(`SELECT name FROM consistency_group WHERE id = \$1`).
			WithArgs(groupA).
			WillReturnError(errNoRows())
		_, err := NewStore().GroupName(context.Background(), mock, groupA)
		if !errors.Is(err, ErrGroupNotFound) {
			t.Fatalf("err = %v, want ErrGroupNotFound", err)
		}
	})
}

func TestStore_EnsureNode_CreatesWhenAbsent(t *testing.T) {
	t.Parallel()
	now := time.Now()
	mock := newMock(t)
	// First the existence read misses, then the insert returns the new node.
	mock.ExpectQuery(`SELECT .* FROM dr_topology_node WHERE group_id = \$1 AND site_id = \$2`).
		WithArgs(groupA, "site-1").
		WillReturnError(errNoRows())
	mock.ExpectQuery(`INSERT INTO dr_topology_node`).
		WithArgs(tenantA, groupA, "site-1", RoleSource).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "site_id", "role", "created_at", "updated_at",
		}).AddRow("node-1", tenantA, groupA, "site-1", RoleSource, now, now))

	n, err := NewStore().EnsureNode(context.Background(), mock, tenantA, groupA, "site-1", RoleSource)
	if err != nil {
		t.Fatalf("EnsureNode: %v", err)
	}
	if n.ID != "node-1" || n.Role != RoleSource {
		t.Fatalf("node = %+v, want node-1/source", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_EnsureNode_ReturnsExisting(t *testing.T) {
	t.Parallel()
	now := time.Now()
	mock := newMock(t)
	mock.ExpectQuery(`SELECT .* FROM dr_topology_node WHERE group_id = \$1 AND site_id = \$2`).
		WithArgs(groupA, "site-1").
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "site_id", "role", "created_at", "updated_at",
		}).AddRow("node-existing", tenantA, groupA, "site-1", RoleRelay, now, now))

	n, err := NewStore().EnsureNode(context.Background(), mock, tenantA, groupA, "site-1", RoleSource)
	if err != nil {
		t.Fatalf("EnsureNode: %v", err)
	}
	if n.ID != "node-existing" {
		t.Fatalf("expected existing node returned, got %+v", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_EnsureNode_RejectsInvalidRole(t *testing.T) {
	t.Parallel()
	mock := newMock(t) // no query expected
	_, err := NewStore().EnsureNode(context.Background(), mock, tenantA, groupA, "site-1", "bogus")
	if !errors.Is(err, ErrInvalidRole) {
		t.Fatalf("err = %v, want ErrInvalidRole", err)
	}
}

func TestStore_InsertEdge(t *testing.T) {
	t.Parallel()
	now := time.Now()
	tests := []struct {
		name    string
		setup   func(m pgxmock.PgxPoolIface)
		wantErr error
	}{
		{
			name: "ok",
			setup: func(m pgxmock.PgxPoolIface) {
				m.ExpectQuery(`INSERT INTO dr_topology_edge`).
					WithArgs(tenantA, groupA, "from-1", "to-1", "stream-1", ModeAsync, 50, HealthUnknown).
					WillReturnRows(pgxmock.NewRows([]string{
						"id", "tenant_id", "group_id", "from_node_id", "to_node_id", "stream_id",
						"mode", "priority", "health", "lag_seconds", "applied_seq", "last_progress_at",
						"created_at", "updated_at",
					}).AddRow("edge-1", tenantA, groupA, "from-1", "to-1", "stream-1",
						ModeAsync, 50, HealthUnknown, nil, int64(0), nil, now, now))
			},
		},
		{
			name: "duplicate maps to ErrEdgeExists",
			setup: func(m pgxmock.PgxPoolIface) {
				m.ExpectQuery(`INSERT INTO dr_topology_edge`).
					WithArgs(tenantA, groupA, "from-1", "to-1", "stream-1", ModeAsync, 50, HealthUnknown).
					WillReturnError(&pgconn.PgError{Code: "23505"})
			},
			wantErr: ErrEdgeExists,
		},
		{
			name: "missing node maps to ErrNodeNotFound",
			setup: func(m pgxmock.PgxPoolIface) {
				m.ExpectQuery(`INSERT INTO dr_topology_edge`).
					WithArgs(tenantA, groupA, "from-1", "to-1", "stream-1", ModeAsync, 50, HealthUnknown).
					WillReturnError(&pgconn.PgError{Code: "23503"})
			},
			wantErr: ErrNodeNotFound,
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mock := newMock(t)
			tt.setup(mock)
			e := &Edge{
				TenantID: tenantA, GroupID: groupA, FromNodeID: "from-1", ToNodeID: "to-1",
				StreamID: "stream-1", Mode: ModeAsync, Priority: 50,
			}
			stored, err := NewStore().InsertEdge(context.Background(), mock, e)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("InsertEdge: %v", err)
			}
			if stored.ID != "edge-1" {
				t.Fatalf("edge id = %q, want edge-1", stored.ID)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestStore_InsertEdge_RejectsInvalidMode(t *testing.T) {
	t.Parallel()
	mock := newMock(t) // no query expected
	_, err := NewStore().InsertEdge(context.Background(), mock, &Edge{Mode: "bogus"})
	if !errors.Is(err, ErrInvalidMode) {
		t.Fatalf("err = %v, want ErrInvalidMode", err)
	}
}

func TestStore_UpdateEdgeHealthByStream_MonotonicArgs(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	mock := newMock(t)
	// The UPDATE must carry GREATEST on applied_seq and last_progress_at so a
	// stale sample cannot regress the ledger — assert the exact args bind.
	mock.ExpectExec(`UPDATE dr_topology_edge`).
		WithArgs("stream-1", HealthDegraded, int64(42), int64(1000), now).
		WillReturnResult(pgxmock.NewResult("UPDATE", 2))

	affected, err := NewStore().UpdateEdgeHealthByStream(context.Background(), mock, "stream-1", HealthUpdate{
		Health: HealthDegraded, LagSeconds: 42, AppliedSeq: 1000, LastProgressAt: now,
	})
	if err != nil {
		t.Fatalf("UpdateEdgeHealthByStream: %v", err)
	}
	if affected != 2 {
		t.Fatalf("affected = %d, want 2 (a fan-out where two edges share the stream)", affected)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_LoadTopology(t *testing.T) {
	t.Parallel()
	now := time.Now()
	mock := newMock(t)
	mock.ExpectQuery(`SELECT name FROM consistency_group WHERE id = \$1`).
		WithArgs(groupA).
		WillReturnRows(pgxmock.NewRows([]string{"name"}).AddRow("g"))
	mock.ExpectQuery(`FROM dr_topology_node n`).
		WithArgs(groupA).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "site_id", "name", "role", "created_at", "updated_at",
		}).
			AddRow("S", tenantA, groupA, "site-s", "site-s", RoleSource, now, now).
			AddRow("T", tenantA, groupA, "site-t", "site-t", RoleTarget, now, now))
	lag := int64(7)
	mock.ExpectQuery(`FROM dr_topology_edge`).
		WithArgs(groupA).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "from_node_id", "to_node_id", "stream_id", "mode",
			"priority", "health", "lag_seconds", "applied_seq", "last_progress_at", "created_at", "updated_at",
		}).AddRow("e1", tenantA, groupA, "S", "T", "stream-1", ModeAsync, 10, HealthHealthy, &lag, int64(5), &now, now, now))

	topo, err := NewStore().LoadTopology(context.Background(), mock, groupA)
	if err != nil {
		t.Fatalf("LoadTopology: %v", err)
	}
	if len(topo.Nodes) != 2 || len(topo.Edges) != 1 {
		t.Fatalf("topo = %d nodes / %d edges, want 2/1", len(topo.Nodes), len(topo.Edges))
	}
	if topo.Edges[0].LagSeconds == nil || *topo.Edges[0].LagSeconds != 7 {
		t.Fatalf("edge lag not loaded: %+v", topo.Edges[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// errNoRows returns the pgx no-rows sentinel the store maps to a not-found
// error. Using the real sentinel exercises the store's errors.Is check.
func errNoRows() error {
	return pgx.ErrNoRows
}

const (
	siteA = "22222222-0000-0000-0000-000000000001"
	edgeA = "33333333-0000-0000-0000-000000000001"
)

func TestStore_SystemBlockSite_SnapshotsFlipsAndRecords(t *testing.T) {
	t.Parallel()
	mock := newMock(t)

	// 1. resolve tenant from the protected site.
	mock.ExpectQuery(`SELECT tenant_id FROM protected_site WHERE id = \$1`).
		WithArgs(siteA).
		WillReturnRows(pgxmock.NewRows([]string{"tenant_id"}).AddRow(tenantA))
	// 2. snapshot the site's edges (their current health) under FOR UPDATE.
	mock.ExpectQuery(`FROM dr_topology_edge`).
		WithArgs(siteA).
		WillReturnRows(pgxmock.NewRows([]string{"id", "health"}).AddRow(edgeA, HealthHealthy))
	// 3. flip exactly those edges to unhealthy.
	mock.ExpectExec(`UPDATE dr_topology_edge`).
		WithArgs([]string{edgeA}, HealthUnhealthy).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	// 4. record the block marker with the prior-health snapshot.
	mock.ExpectExec(`INSERT INTO dr_drill_site_block`).
		WithArgs(siteA, tenantA, pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	if err := NewStore().SystemBlockSite(context.Background(), mock, siteA); err != nil {
		t.Fatalf("SystemBlockSite: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_SystemBlockSite_MissingSite(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	mock.ExpectQuery(`SELECT tenant_id FROM protected_site WHERE id = \$1`).
		WithArgs(siteA).
		WillReturnError(errNoRows())

	err := NewStore().SystemBlockSite(context.Background(), mock, siteA)
	if !errors.Is(err, ErrSiteNotFound) {
		t.Fatalf("err = %v, want ErrSiteNotFound", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_SystemBlockSite_NoEdgesStillRecordsMarker(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	mock.ExpectQuery(`SELECT tenant_id FROM protected_site WHERE id = \$1`).
		WithArgs(siteA).
		WillReturnRows(pgxmock.NewRows([]string{"tenant_id"}).AddRow(tenantA))
	// No edges touch the site: the snapshot query returns no rows, so the flip
	// UPDATE is skipped and an empty marker is recorded (revert is still safe).
	mock.ExpectQuery(`FROM dr_topology_edge`).
		WithArgs(siteA).
		WillReturnRows(pgxmock.NewRows([]string{"id", "health"}))
	mock.ExpectExec(`INSERT INTO dr_drill_site_block`).
		WithArgs(siteA, tenantA, pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	if err := NewStore().SystemBlockSite(context.Background(), mock, siteA); err != nil {
		t.Fatalf("SystemBlockSite (no edges): %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_SystemRestoreSite_RestoresAndClears(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	snapshot := []byte(`[{"edge_id":"` + edgeA + `","prev_health":"healthy"}]`)

	mock.ExpectQuery(`SELECT snapshot FROM dr_drill_site_block WHERE site_id = \$1`).
		WithArgs(siteA).
		WillReturnRows(pgxmock.NewRows([]string{"snapshot"}).AddRow(snapshot))
	mock.ExpectExec(`UPDATE dr_topology_edge`).
		WithArgs(snapshot).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectExec(`DELETE FROM dr_drill_site_block WHERE site_id = \$1`).
		WithArgs(siteA).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))

	if err := NewStore().SystemRestoreSite(context.Background(), mock, siteA); err != nil {
		t.Fatalf("SystemRestoreSite: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_SystemRestoreSite_NoMarkerIsNoOp(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	// No block marker: the revert is idempotent and touches nothing else.
	mock.ExpectQuery(`SELECT snapshot FROM dr_drill_site_block WHERE site_id = \$1`).
		WithArgs(siteA).
		WillReturnError(errNoRows())

	if err := NewStore().SystemRestoreSite(context.Background(), mock, siteA); err != nil {
		t.Fatalf("SystemRestoreSite on absent block must be a no-op: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
