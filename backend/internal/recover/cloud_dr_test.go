package recover

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/bootgraph"
	drmodel "github.com/clario360/platform/internal/dr/model"
)

// withUser is defined in router_test.go (same package): it injects an
// authenticated user + tenant into the request context, with roles that map to
// DR permissions ("analyst" → dr:read).

// ---- fakes (mocks live only in test files) ---------------------------------

type fakePlanner struct {
	plans map[string]bootgraph.BootPlan
	err   error
	mu    sync.Mutex
	calls int
}

func (f *fakePlanner) GetPlan(_ context.Context, _ uuid.UUID, groupID string) (bootgraph.BootPlan, error) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	if f.err != nil {
		return bootgraph.BootPlan{}, f.err
	}
	return f.plans[groupID], nil
}

type fakeEstate struct {
	groups       []drmodel.ConsistencyGroup
	members      map[string][]drmodel.ConsistencyGroupMember
	sites        []drmodel.ProtectedSite
	failoverRuns []drmodel.FailoverRun
	groupsErr    error
	runsErr      error
}

func (f *fakeEstate) ListGroups(context.Context, uuid.UUID) ([]drmodel.ConsistencyGroup, error) {
	return f.groups, f.groupsErr
}
func (f *fakeEstate) ListGroupMembers(_ context.Context, _ uuid.UUID, groupID string) ([]drmodel.ConsistencyGroupMember, error) {
	return f.members[groupID], nil
}
func (f *fakeEstate) ListSites(context.Context, uuid.UUID) ([]drmodel.ProtectedSite, error) {
	return f.sites, nil
}
func (f *fakeEstate) ListFailoverRuns(context.Context, uuid.UUID) ([]drmodel.FailoverRun, error) {
	return f.failoverRuns, f.runsErr
}

type fakeWorkloads struct {
	vm     []VMSourceSummary
	iac    []IaCSnapshotSummary
	vmErr  error
	iacErr error
}

func (f *fakeWorkloads) ListVMSources(context.Context, uuid.UUID) ([]VMSourceSummary, error) {
	return f.vm, f.vmErr
}
func (f *fakeWorkloads) ListIaCSnapshots(context.Context, uuid.UUID) ([]IaCSnapshotSummary, error) {
	return f.iac, f.iacErr
}

func svc(t *testing.T, p BootPlanner, e EstateReader, w WorkloadReader) *CloudDRService {
	t.Helper()
	s, err := NewCloudDRService(CloudDRConfig{Planner: p, Estate: e, Workloads: w, Logger: zerolog.Nop()})
	if err != nil {
		t.Fatalf("NewCloudDRService: %v", err)
	}
	return s
}

// twoTierPlan: tier0=[database], tier1=[api] — a real dependency order.
func twoTierPlan(groupID string) bootgraph.BootPlan {
	return bootgraph.BootPlan{
		GroupID: groupID,
		Tiers: [][]bootgraph.Service{
			{{ID: "s1", Name: "database", Kind: "database"}},
			{{ID: "s2", Name: "api", Kind: "api"}},
		},
	}
}

// ---- happy path ------------------------------------------------------------

func TestOverview_ComposesRealState(t *testing.T) {
	g := drmodel.ConsistencyGroup{ID: uuid.NewString(), Name: "eu-west-1"}
	siteID := uuid.NewString()
	planner := &fakePlanner{plans: map[string]bootgraph.BootPlan{g.ID: twoTierPlan(g.ID)}}
	estate := &fakeEstate{
		groups:  []drmodel.ConsistencyGroup{g},
		members: map[string][]drmodel.ConsistencyGroupMember{g.ID: {{GroupID: g.ID, SiteID: siteID}}},
		sites:   []drmodel.ProtectedSite{{ID: siteID, Name: "frankfurt-az1"}},
		failoverRuns: []drmodel.FailoverRun{
			{ID: "old", GroupID: g.ID, Mode: drmodel.ModeDrill, Status: drmodel.StatusCompleted, RTOObjectiveSeconds: 600, InitiatedAt: time.Unix(1000, 0)},
			{ID: "new", GroupID: g.ID, Mode: drmodel.ModeReal, Status: drmodel.StatusCompleted, RTOObjectiveSeconds: 600, InitiatedAt: time.Unix(2000, 0)},
		},
	}
	workloads := &fakeWorkloads{
		vm:  []VMSourceSummary{{ID: "v1", Name: "web-vm"}},
		iac: []IaCSnapshotSummary{{ID: "i1", Name: "tf-prod", ResourceCount: 12}},
	}

	view, err := svc(t, planner, estate, workloads).Overview(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("Overview: %v", err)
	}
	if view.Workloads.VMSources != 1 || view.Workloads.IaCSnapshots != 1 {
		t.Errorf("workloads = %+v", view.Workloads)
	}
	if view.LastFailoverTest == nil || view.LastFailoverTest.ID != "new" {
		t.Fatalf("last failover test = %+v, want most-recent 'new'", view.LastFailoverTest)
	}
	if view.BootGraph.TotalScopes != 1 || view.BootGraph.ScopesWithPlan != 1 || view.BootGraph.TotalServices != 2 {
		t.Errorf("boot graph summary = %+v", view.BootGraph)
	}
	if len(view.BootGraph.Scopes) != 1 || view.BootGraph.Scopes[0].TierCount != 2 {
		t.Errorf("scopes = %+v", view.BootGraph.Scopes)
	}
	if len(view.BootGraph.Scopes[0].SiteNames) != 1 || view.BootGraph.Scopes[0].SiteNames[0] != "frankfurt-az1" {
		t.Errorf("site names = %+v", view.BootGraph.Scopes[0].SiteNames)
	}
}

func TestOverview_NoFailoverRuns_NilSummary(t *testing.T) {
	view, err := svc(t, &fakePlanner{plans: map[string]bootgraph.BootPlan{}}, &fakeEstate{}, &fakeWorkloads{}).
		Overview(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("Overview: %v", err)
	}
	if view.LastFailoverTest != nil {
		t.Errorf("last failover test = %+v, want nil with no runs", view.LastFailoverTest)
	}
	if view.BootGraph.TotalScopes != 0 {
		t.Errorf("scopes = %d, want 0", view.BootGraph.TotalScopes)
	}
}

// ---- region boot plan: real ordering surfaced ------------------------------

func TestRegionBootPlan_SurfacesRealOrdering(t *testing.T) {
	g := drmodel.ConsistencyGroup{ID: uuid.NewString(), Name: "us-east-1"}
	planner := &fakePlanner{plans: map[string]bootgraph.BootPlan{g.ID: twoTierPlan(g.ID)}}
	estate := &fakeEstate{groups: []drmodel.ConsistencyGroup{g}}

	plan, err := svc(t, planner, estate, &fakeWorkloads{}).RegionBootPlan(context.Background(), uuid.New(), g.ID)
	if err != nil {
		t.Fatalf("RegionBootPlan: %v", err)
	}
	if plan.TierCount != 2 || plan.ServiceCount != 2 {
		t.Errorf("plan counts = %+v", plan)
	}
	// Tier 0 must boot before tier 1 — the real dependency order from bootgraph.
	if plan.Tiers[0][0].Name != "database" || plan.Tiers[1][0].Name != "api" {
		t.Errorf("ordering not surfaced verbatim: %+v", plan.Tiers)
	}
}

// ---- failure / edge paths --------------------------------------------------

func TestRegionBootPlan_UnknownRegion(t *testing.T) {
	s := svc(t, &fakePlanner{plans: map[string]bootgraph.BootPlan{}}, &fakeEstate{}, &fakeWorkloads{})
	if _, err := s.RegionBootPlan(context.Background(), uuid.New(), uuid.NewString()); !errors.Is(err, ErrUnknownRegion) {
		t.Fatalf("err = %v, want ErrUnknownRegion", err)
	}
}

func TestRegionBootPlan_InvalidGroupID(t *testing.T) {
	s := svc(t, &fakePlanner{plans: map[string]bootgraph.BootPlan{}}, &fakeEstate{}, &fakeWorkloads{})
	if _, err := s.RegionBootPlan(context.Background(), uuid.New(), "not-a-uuid"); !errors.Is(err, ErrUnknownRegion) {
		t.Fatalf("err = %v, want ErrUnknownRegion for invalid id", err)
	}
}

func TestOverview_PlannerErrorPropagates(t *testing.T) {
	g := drmodel.ConsistencyGroup{ID: uuid.NewString(), Name: "x"}
	planner := &fakePlanner{err: errors.New("bootgraph down")}
	estate := &fakeEstate{groups: []drmodel.ConsistencyGroup{g}}
	if _, err := svc(t, planner, estate, &fakeWorkloads{}).Overview(context.Background(), uuid.New()); !errors.Is(err, ErrCloudDRReader) {
		t.Fatalf("err = %v, want ErrCloudDRReader", err)
	}
}

func TestOverview_WorkloadErrorPropagates(t *testing.T) {
	w := &fakeWorkloads{vmErr: errors.New("vmcapture down")}
	if _, err := svc(t, &fakePlanner{}, &fakeEstate{}, w).Overview(context.Background(), uuid.New()); !errors.Is(err, ErrCloudDRReader) {
		t.Fatalf("err = %v, want ErrCloudDRReader", err)
	}
}

func TestOverview_RequiresTenant(t *testing.T) {
	s := svc(t, &fakePlanner{}, &fakeEstate{}, &fakeWorkloads{})
	if _, err := s.Overview(context.Background(), uuid.Nil); err == nil {
		t.Fatal("expected error for nil tenant")
	}
}

func TestNewCloudDRService_Validation(t *testing.T) {
	good := CloudDRConfig{Planner: &fakePlanner{}, Estate: &fakeEstate{}, Workloads: &fakeWorkloads{}, Logger: zerolog.Nop()}
	for name, mutate := range map[string]func(*CloudDRConfig){
		"nil planner":   func(c *CloudDRConfig) { c.Planner = nil },
		"nil estate":    func(c *CloudDRConfig) { c.Estate = nil },
		"nil workloads": func(c *CloudDRConfig) { c.Workloads = nil },
	} {
		cfg := good
		mutate(&cfg)
		if _, err := NewCloudDRService(cfg); err == nil {
			t.Errorf("%s: expected validation error", name)
		}
	}
}

// ---- concurrency: the read surface is safe under parallel callers ----------

func TestOverview_ConcurrentReads(t *testing.T) {
	g := drmodel.ConsistencyGroup{ID: uuid.NewString(), Name: "eu-west-1"}
	planner := &fakePlanner{plans: map[string]bootgraph.BootPlan{g.ID: twoTierPlan(g.ID)}}
	estate := &fakeEstate{groups: []drmodel.ConsistencyGroup{g}}
	s := svc(t, planner, estate, &fakeWorkloads{})

	const n = 32
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Overview(context.Background(), uuid.New()); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent Overview failed: %v", err)
	}
	if planner.calls != n {
		t.Errorf("planner calls = %d, want %d (one plan read per scope per call)", planner.calls, n)
	}
}

// ---- HTTP / authorization --------------------------------------------------

// fakeCloudDRSvc drives the router without the composition service.
type fakeCloudDRSvc struct {
	overview *CloudDROverview
	regions  []RegionBootStatus
	plan     *RegionFailoverPlan
	err      error
}

func (f *fakeCloudDRSvc) Overview(context.Context, uuid.UUID) (*CloudDROverview, error) {
	return f.overview, f.err
}
func (f *fakeCloudDRSvc) Regions(context.Context, uuid.UUID) ([]RegionBootStatus, error) {
	return f.regions, f.err
}
func (f *fakeCloudDRSvc) RegionBootPlan(context.Context, uuid.UUID, string) (*RegionFailoverPlan, error) {
	return f.plan, f.err
}

func TestRouter_Overview_AuthorizedAndDenied(t *testing.T) {
	router := newCloudDRRouter(&fakeCloudDRSvc{overview: &CloudDROverview{}}, zerolog.Nop()).Routes()

	// authorized — "analyst" role carries dr:read.
	req := httptest.NewRequest(http.MethodGet, "/overview", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusOK {
		t.Fatalf("authorized overview = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	// denied — a role with no dr:read permission.
	req2 := httptest.NewRequest(http.MethodGet, "/overview", nil)
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, withUser(req2, uuid.New(), "no_dr"))
	if rec2.Code != http.StatusForbidden {
		t.Fatalf("unauthorized overview = %d, want 403", rec2.Code)
	}
}

func TestRouter_RegionBootPlan_NotFound(t *testing.T) {
	router := newCloudDRRouter(&fakeCloudDRSvc{err: ErrUnknownRegion}, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/regions/"+uuid.NewString()+"/boot-plan", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown region = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}
