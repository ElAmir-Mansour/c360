package topology

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// In-memory fakes — a real graph-backed store substitute (NOT a mock-only test:
// the fake holds actual node/edge state and the service's cycle check runs the
// real Graph engine over it; the SQL-level store is covered by store_test.go).
// ---------------------------------------------------------------------------

type fakeStore struct {
	mu       sync.Mutex
	groups   map[string]string // groupID -> name
	nodes    map[string]*Node  // nodeID -> node
	bySite   map[string]string // group|site -> nodeID
	edges    []Edge
	nextNode int
	nextEdge int
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		groups: map[string]string{},
		nodes:  map[string]*Node{},
		bySite: map[string]string{},
	}
}

func (f *fakeStore) addGroup(id, name string) { f.groups[id] = name }

func (f *fakeStore) GroupName(_ context.Context, _ DBTX, groupID string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	name, ok := f.groups[groupID]
	if !ok {
		return "", fmt.Errorf("group %s: %w", groupID, ErrGroupNotFound)
	}
	return name, nil
}

func (f *fakeStore) EnsureNode(_ context.Context, _ DBTX, tenantID, groupID, siteID, role string) (*Node, error) {
	if !ValidRole(role) {
		return nil, ErrInvalidRole
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	key := groupID + "|" + siteID
	if id, ok := f.bySite[key]; ok {
		return f.nodes[id], nil
	}
	f.nextNode++
	id := fmt.Sprintf("node-%d", f.nextNode)
	n := &Node{ID: id, TenantID: tenantID, GroupID: groupID, SiteID: siteID, SiteName: siteID, Role: role}
	f.nodes[id] = n
	f.bySite[key] = id
	return n, nil
}

func (f *fakeStore) GetNode(_ context.Context, _ DBTX, nodeID string) (*Node, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if n, ok := f.nodes[nodeID]; ok {
		return n, nil
	}
	return nil, ErrNodeNotFound
}

func (f *fakeStore) InsertEdge(_ context.Context, _ DBTX, e *Edge) (*Edge, error) {
	if !ValidMode(e.Mode) {
		return nil, ErrInvalidMode
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, ex := range f.edges {
		if ex.FromNodeID == e.FromNodeID && ex.ToNodeID == e.ToNodeID {
			return nil, ErrEdgeExists
		}
	}
	f.nextEdge++
	stored := *e
	stored.ID = fmt.Sprintf("edge-%d", f.nextEdge)
	stored.Health = HealthUnknown
	f.edges = append(f.edges, stored)
	return &stored, nil
}

func (f *fakeStore) LoadTopology(_ context.Context, _ DBTX, groupID string) (Topology, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	name, ok := f.groups[groupID]
	if !ok {
		return Topology{}, fmt.Errorf("group %s: %w", groupID, ErrGroupNotFound)
	}
	_ = name
	t := Topology{GroupID: groupID}
	for _, n := range f.nodes {
		if n.GroupID == groupID {
			t.Nodes = append(t.Nodes, *n)
		}
	}
	for _, e := range f.edges {
		if e.GroupID == groupID {
			t.Edges = append(t.Edges, e)
		}
	}
	return t, nil
}

func (f *fakeStore) LoadEdgesForLock(_ context.Context, _ DBTX, groupID string) ([]Edge, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []Edge
	for _, e := range f.edges {
		if e.GroupID == groupID {
			out = append(out, e)
		}
	}
	return out, nil
}

func (f *fakeStore) UpdateEdgeHealthByStream(_ context.Context, _ DBTX, streamID string, u HealthUpdate) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var n int64
	for i := range f.edges {
		if f.edges[i].StreamID == streamID {
			f.edges[i].Health = u.Health
			lag := u.LagSeconds
			f.edges[i].LagSeconds = &lag
			if u.AppliedSeq > f.edges[i].AppliedSeq {
				f.edges[i].AppliedSeq = u.AppliedSeq
			}
			t := u.LastProgressAt
			f.edges[i].LastProgressAt = &t
			n++
		}
	}
	return n, nil
}

// fakeRunner runs fn directly with a nil DBTX (the fake store ignores it). It
// records whether a tenant tx committed or rolled back so a cycle-rejection test
// can assert nothing was persisted.
type fakeRunner struct {
	store        *fakeStore
	rollbackSeen bool
}

func (r *fakeRunner) RunWithTenant(ctx context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	// Snapshot the edge count; if fn errors we treat it as a rollback (the fake
	// store mutated nothing because InsertEdge is the last write and a cycle
	// rejection happens before it).
	before := len(r.store.edges)
	err := fn(nil)
	if err != nil {
		r.rollbackSeen = true
		if len(r.store.edges) != before {
			// A real tx would roll back; the fake must not have persisted an edge on
			// the error path. The service rejects the cycle BEFORE InsertEdge, so the
			// count is unchanged — assert that invariant here.
		}
	}
	return err
}

func (r *fakeRunner) RunReadWithTenant(ctx context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}
func (r *fakeRunner) RunSystem(ctx context.Context, fn func(DBTX) error) error     { return fn(nil) }
func (r *fakeRunner) RunSystemRead(ctx context.Context, fn func(DBTX) error) error { return fn(nil) }

// recordingStager records staged events so a test can assert exactly-once
// staging in the same tx as the edge write.
type recordingStager struct {
	events []stagedEvent
	fail   bool
}

type stagedEvent struct {
	eventType string
	tenantID  string
	data      map[string]any
}

func (s *recordingStager) Stage(_ context.Context, _ DBTX, eventType, tenantID string, data map[string]any) error {
	if s.fail {
		return errors.New("stage failed")
	}
	s.events = append(s.events, stagedEvent{eventType, tenantID, data})
	return nil
}

func newTestService(t *testing.T, store *fakeStore, stager eventStager) (*Service, *fakeRunner) {
	t.Helper()
	runner := &fakeRunner{store: store}
	svc, err := NewService(Config{
		Store:   store,
		Runner:  runner,
		Stager:  stager,
		Metrics: NewMetrics(nil),
		Now:     func() time.Time { return time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc, runner
}

// ---------------------------------------------------------------------------
// AddEdge — fan-out, cascade, cycle rejection
// ---------------------------------------------------------------------------

func TestService_AddEdge_FanOut(t *testing.T) {
	store := newFakeStore()
	store.addGroup(groupA, "fanout")
	stager := &recordingStager{}
	svc, _ := newTestService(t, store, stager)
	ctx := context.Background()
	tid := uuid.MustParse(tenantA)

	// One source fanning out to three targets.
	for i, target := range []string{"t1", "t2", "t3"} {
		_, err := svc.AddEdge(ctx, tid, groupA, AddEdgeInput{
			FromSiteID: "source", ToSiteID: target,
			FromRole: RoleSource, ToRole: RoleTarget,
			StreamID: fmt.Sprintf("stream-%d", i), Mode: ModeAsync, Priority: (i + 1) * 10,
		})
		if err != nil {
			t.Fatalf("AddEdge to %s: %v", target, err)
		}
	}

	topo, _ := store.LoadTopology(ctx, nil, groupA)
	if len(topo.Edges) != 3 {
		t.Fatalf("fan-out should have 3 edges, got %d", len(topo.Edges))
	}
	if len(stager.events) != 3 {
		t.Fatalf("expected 3 staged edge.added events, got %d", len(stager.events))
	}
	for _, e := range stager.events {
		if e.eventType != eventEdgeAdded {
			t.Fatalf("staged event type = %q, want %q", e.eventType, eventEdgeAdded)
		}
	}
	// The source must reach all three targets.
	reach := NewGraph(topo).ReachableTargets(findNode(topo, "source").ID)
	if len(reach) != 3 {
		t.Fatalf("source should reach 3 targets, reached %d", len(reach))
	}
}

func TestService_AddEdge_Cascade(t *testing.T) {
	store := newFakeStore()
	store.addGroup(groupA, "cascade")
	stager := &recordingStager{}
	svc, _ := newTestService(t, store, stager)
	ctx := context.Background()
	tid := uuid.MustParse(tenantA)

	// A -> B (B is a relay), then B -> C.
	if _, err := svc.AddEdge(ctx, tid, groupA, AddEdgeInput{
		FromSiteID: "A", ToSiteID: "B", FromRole: RoleSource, ToRole: RoleRelay,
		StreamID: "s-ab", Mode: ModeSync, Priority: 10,
	}); err != nil {
		t.Fatalf("AddEdge A->B: %v", err)
	}
	if _, err := svc.AddEdge(ctx, tid, groupA, AddEdgeInput{
		FromSiteID: "B", ToSiteID: "C", FromRole: RoleRelay, ToRole: RoleTarget,
		StreamID: "s-bc", Mode: ModeAsync, Priority: 20,
	}); err != nil {
		t.Fatalf("AddEdge B->C: %v", err)
	}

	topo, _ := store.LoadTopology(ctx, nil, groupA)
	a := findNode(topo, "A")
	reach := NewGraph(topo).ReachableTargets(a.ID)
	if len(reach) != 2 {
		t.Fatalf("A should reach B and C (2), reached %d", len(reach))
	}
	order, ok := NewGraph(topo).TopoSort()
	if !ok || len(order) != 3 {
		t.Fatalf("cascade topo sort = %v ok=%v", order, ok)
	}
}

func TestService_AddEdge_RejectsCycle(t *testing.T) {
	store := newFakeStore()
	store.addGroup(groupA, "cascade")
	stager := &recordingStager{}
	svc, runner := newTestService(t, store, stager)
	ctx := context.Background()
	tid := uuid.MustParse(tenantA)

	mustAdd := func(from, to, fr, tr string) {
		t.Helper()
		if _, err := svc.AddEdge(ctx, tid, groupA, AddEdgeInput{
			FromSiteID: from, ToSiteID: to, FromRole: fr, ToRole: tr,
			StreamID: "s", Mode: ModeAsync, Priority: 10,
		}); err != nil {
			t.Fatalf("AddEdge %s->%s: %v", from, to, err)
		}
	}
	mustAdd("A", "B", RoleSource, RoleRelay)
	mustAdd("B", "C", RoleRelay, RoleTarget)

	edgesBefore := len(store.edges)
	stagedBefore := len(stager.events)

	// C -> A would close the chain into a loop.
	_, err := svc.AddEdge(ctx, tid, groupA, AddEdgeInput{
		FromSiteID: "C", ToSiteID: "A", FromRole: RoleRelay, ToRole: RoleRelay,
		StreamID: "s", Mode: ModeAsync, Priority: 10,
	})
	if !errors.Is(err, ErrCycle) {
		t.Fatalf("AddEdge C->A err = %v, want ErrCycle", err)
	}
	if len(store.edges) != edgesBefore {
		t.Fatalf("a rejected cycle must not persist an edge: %d != %d", len(store.edges), edgesBefore)
	}
	if len(stager.events) != stagedBefore {
		t.Fatal("a rejected cycle must not stage an event")
	}
	if !runner.rollbackSeen {
		t.Fatal("the cycle rejection must surface as a tx error (rollback)")
	}
}

func TestService_AddEdge_RejectsSelfEdge(t *testing.T) {
	store := newFakeStore()
	store.addGroup(groupA, "g")
	svc, _ := newTestService(t, store, &recordingStager{})
	_, err := svc.AddEdge(context.Background(), uuid.MustParse(tenantA), groupA, AddEdgeInput{
		FromSiteID: "X", ToSiteID: "X",
	})
	if !errors.Is(err, ErrSelfEdge) {
		t.Fatalf("err = %v, want ErrSelfEdge", err)
	}
}

func TestService_AddEdge_MissingGroup(t *testing.T) {
	store := newFakeStore() // no group added
	svc, _ := newTestService(t, store, &recordingStager{})
	_, err := svc.AddEdge(context.Background(), uuid.MustParse(tenantA), groupA, AddEdgeInput{
		FromSiteID: "A", ToSiteID: "B",
	})
	if !errors.Is(err, ErrGroupNotFound) {
		t.Fatalf("err = %v, want ErrGroupNotFound", err)
	}
}

func TestService_AddEdge_StagerFailureRollsBack(t *testing.T) {
	store := newFakeStore()
	store.addGroup(groupA, "g")
	stager := &recordingStager{fail: true}
	svc, runner := newTestService(t, store, stager)
	_, err := svc.AddEdge(context.Background(), uuid.MustParse(tenantA), groupA, AddEdgeInput{
		FromSiteID: "A", ToSiteID: "B", StreamID: "s",
	})
	if err == nil {
		t.Fatal("expected the stager failure to fail AddEdge")
	}
	if !runner.rollbackSeen {
		t.Fatal("a stager failure must roll the tx back")
	}
}

// ---------------------------------------------------------------------------
// SelectFailoverTarget through the service (uses live health set on the edges)
// ---------------------------------------------------------------------------

func TestService_SelectFailoverTarget(t *testing.T) {
	store := newFakeStore()
	store.addGroup(groupA, "fanout")
	svc, _ := newTestService(t, store, &recordingStager{})
	ctx := context.Background()
	tid := uuid.MustParse(tenantA)

	// Build a fan-out and roll live health onto the streams via the store.
	for i, target := range []string{"t1", "t2", "t3"} {
		if _, err := svc.AddEdge(ctx, tid, groupA, AddEdgeInput{
			FromSiteID: "source", ToSiteID: target, FromRole: RoleSource, ToRole: RoleTarget,
			StreamID: fmt.Sprintf("stream-%s", target), Mode: ModeAsync, Priority: (i + 1) * 10,
		}); err != nil {
			t.Fatalf("AddEdge: %v", err)
		}
	}
	// t1: healthy lag 9; t2: healthy lag 2 (winner); t3: unhealthy.
	store.UpdateEdgeHealthByStream(ctx, nil, "stream-t1", HealthUpdate{Health: HealthHealthy, LagSeconds: 9, AppliedSeq: 100, LastProgressAt: time.Now()})
	store.UpdateEdgeHealthByStream(ctx, nil, "stream-t2", HealthUpdate{Health: HealthHealthy, LagSeconds: 2, AppliedSeq: 100, LastProgressAt: time.Now()})
	store.UpdateEdgeHealthByStream(ctx, nil, "stream-t3", HealthUpdate{Health: HealthUnhealthy, LagSeconds: 0, AppliedSeq: 0, LastProgressAt: time.Now()})

	sel, err := svc.SelectFailoverTarget(ctx, tid, groupA)
	if err != nil {
		t.Fatalf("SelectFailoverTarget: %v", err)
	}
	if sel.Selected == nil || sel.Selected.SiteName != "t2" {
		t.Fatalf("selected = %v, want t2", sel.Selected)
	}
	if sel.EvaluatedAt.IsZero() {
		t.Fatal("evaluatedAt should be set from the injected clock")
	}
}

func TestService_GetTopology_ReturnsOrder(t *testing.T) {
	store := newFakeStore()
	store.addGroup(groupA, "cascade")
	svc, _ := newTestService(t, store, &recordingStager{})
	ctx := context.Background()
	tid := uuid.MustParse(tenantA)
	svc.AddEdge(ctx, tid, groupA, AddEdgeInput{FromSiteID: "A", ToSiteID: "B", FromRole: RoleSource, ToRole: RoleRelay, StreamID: "s1"})
	svc.AddEdge(ctx, tid, groupA, AddEdgeInput{FromSiteID: "B", ToSiteID: "C", FromRole: RoleRelay, ToRole: RoleTarget, StreamID: "s2"})

	topo, order, err := svc.GetTopology(ctx, tid, groupA)
	if err != nil {
		t.Fatalf("GetTopology: %v", err)
	}
	if len(topo.Nodes) != 3 || len(topo.Edges) != 2 {
		t.Fatalf("topo = %d/%d, want 3/2", len(topo.Nodes), len(topo.Edges))
	}
	if len(order) != 3 {
		t.Fatalf("topo order length = %d, want 3", len(order))
	}
}

func findNode(t Topology, siteID string) Node {
	for _, n := range t.Nodes {
		if n.SiteID == siteID {
			return n
		}
	}
	return Node{}
}
