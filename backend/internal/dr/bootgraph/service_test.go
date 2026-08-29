package bootgraph

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// fakeStore is an in-memory storeAPI for service-level unit tests. It models the
// four owned tables with maps and applies the real planner-relevant constraints
// (unique service name per group, FK existence) so the service's transactional
// logic is exercised without a database. The DBTX argument is ignored (the fake
// runner passes nil).
type fakeStore struct {
	mu        sync.Mutex
	groups    map[string]bool
	services  map[string][]Service    // groupID -> services
	deps      map[string][]Dependency // groupID -> deps
	runs      map[string]*BootRun
	statuses  map[string][]BootServiceStatus // runID -> statuses
	seq       int
	failGroup bool
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		groups:   map[string]bool{},
		services: map[string][]Service{},
		deps:     map[string][]Dependency{},
		runs:     map[string]*BootRun{},
		statuses: map[string][]BootServiceStatus{},
	}
}

func (f *fakeStore) nextID(prefix string) string {
	f.seq++
	return prefix + "-" + uuid.NewString()[:8]
}

func (f *fakeStore) GroupName(_ context.Context, _ DBTX, groupID string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failGroup || !f.groups[groupID] {
		return "", ErrGroupNotFound
	}
	return "group-" + groupID, nil
}

func (f *fakeStore) UpsertService(_ context.Context, _ DBTX, in *Service) (*Service, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !ValidProbeKind(in.ProbeKind) {
		return nil, ErrInvalidProbe
	}
	list := f.services[in.GroupID]
	for i, s := range list {
		if s.Name == in.Name {
			// Update in place, preserve ID.
			updated := *in
			updated.ID = s.ID
			updated.CreatedAt = s.CreatedAt
			updated.UpdatedAt = time.Now()
			list[i] = updated
			f.services[in.GroupID] = list
			return &updated, nil
		}
	}
	stored := *in
	stored.ID = f.nextID("svc")
	stored.CreatedAt = time.Now()
	stored.UpdatedAt = stored.CreatedAt
	f.services[in.GroupID] = append(list, stored)
	return &stored, nil
}

func (f *fakeStore) InsertDependency(_ context.Context, _ DBTX, d *Dependency) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if d.ServiceID == d.DependsOnID {
		return ErrSelfDependency
	}
	for _, e := range f.deps[d.GroupID] {
		if e.ServiceID == d.ServiceID && e.DependsOnID == d.DependsOnID {
			return nil // dup no-op
		}
	}
	stored := *d
	stored.ID = f.nextID("dep")
	f.deps[d.GroupID] = append(f.deps[d.GroupID], stored)
	return nil
}

func (f *fakeStore) LoadServices(_ context.Context, _ DBTX, groupID string) ([]Service, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.groups[groupID] {
		return nil, ErrGroupNotFound
	}
	out := append([]Service{}, f.services[groupID]...)
	return out, nil
}

func (f *fakeStore) LoadDependencies(_ context.Context, _ DBTX, groupID string) ([]Dependency, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Dependency{}, f.deps[groupID]...), nil
}

func (f *fakeStore) LoadServicesForLock(ctx context.Context, db DBTX, groupID string) ([]Service, error) {
	return f.LoadServices(ctx, db, groupID)
}

func (f *fakeStore) CreateRun(_ context.Context, _ DBTX, run *BootRun, plan BootPlan) (*BootRun, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.groups[run.GroupID] {
		return nil, ErrGroupNotFound
	}
	stored := *run
	stored.ID = f.nextID("run")
	stored.Status = RunStatusPending
	stored.TotalTiers = len(plan.Tiers)
	stored.StartedAt = time.Now()
	f.runs[stored.ID] = &stored
	var statuses []BootServiceStatus
	for tierIdx, tier := range plan.Tiers {
		for _, s := range tier {
			statuses = append(statuses, BootServiceStatus{
				ID:          f.nextID("st"),
				RunID:       stored.ID,
				ServiceID:   s.ID,
				ServiceName: s.Name,
				Tier:        tierIdx,
				Status:      SvcPending,
			})
		}
	}
	f.statuses[stored.ID] = statuses
	return &stored, nil
}

func (f *fakeStore) SetRunStatus(_ context.Context, _ DBTX, runID, status string, tiersBooted int, lastErr *string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.runs[runID]
	if !ok {
		return ErrRunNotFound
	}
	r.Status = status
	r.TiersBooted = tiersBooted
	r.LastError = lastErr
	if status == RunStatusCompleted || status == RunStatusFailed || status == RunStatusRolledBack {
		now := time.Now()
		r.CompletedAt = &now
	}
	return nil
}

func (f *fakeStore) GetRun(_ context.Context, _ DBTX, runID string) (*BootRun, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.runs[runID]
	if !ok {
		return nil, ErrRunNotFound
	}
	cp := *r
	return &cp, nil
}

func (f *fakeStore) ListRunStatuses(_ context.Context, _ DBTX, runID string) ([]BootServiceStatus, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]BootServiceStatus{}, f.statuses[runID]...), nil
}

func (f *fakeStore) setStatus(runID, serviceID, status string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	list := f.statuses[runID]
	for i := range list {
		if list[i].ServiceID == serviceID {
			list[i].Status = status
			list[i].UpdatedAt = time.Now()
		}
	}
}

func (f *fakeStore) MarkServiceBooting(_ context.Context, _ DBTX, runID, serviceID string, _, _ int) error {
	f.setStatus(runID, serviceID, SvcBooting)
	return nil
}

func (f *fakeStore) MarkServiceHealthy(_ context.Context, _ DBTX, runID, serviceID string, _ int, _ time.Time) error {
	f.setStatus(runID, serviceID, SvcHealthy)
	return nil
}

func (f *fakeStore) MarkServiceUnhealthy(_ context.Context, _ DBTX, runID, serviceID string, _ int, _ string) error {
	f.setStatus(runID, serviceID, SvcUnhealthy)
	return nil
}

func (f *fakeStore) MarkServiceRolledBack(_ context.Context, _ DBTX, runID, serviceID string) error {
	f.setStatus(runID, serviceID, SvcRolledBack)
	return nil
}

// fakeRunner runs fn with a nil DBTX (the fake store ignores it).
type fakeRunner struct{}

func (fakeRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}

func (fakeRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}

// stagedEvent captures a staged lifecycle event for assertion.
type recordingStager struct {
	mu     sync.Mutex
	events []string
}

func (s *recordingStager) Stage(_ context.Context, _ DBTX, eventType, _ string, _ map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, eventType)
	return nil
}

func (s *recordingStager) has(eventType string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.events {
		if e == eventType {
			return true
		}
	}
	return false
}

func newTestService(t *testing.T, store storeAPI, stager eventStager, checker func(Service) HealthChecker) *Manager {
	t.Helper()
	svc, err := NewService(Config{
		Store:        store,
		Runner:       fakeRunner{},
		Stager:       stager,
		CheckerFor:   checker,
		RetryBackoff: time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

func TestService_DefineServices_ComputesTiers(t *testing.T) {
	store := newFakeStore()
	store.groups["g1"] = true
	stager := &recordingStager{}
	svc := newTestService(t, store, stager, nil)

	plan, err := svc.DefineServices(context.Background(), uuid.New(), "g1", []ServiceSpec{
		{Name: "db", ProbeKind: ProbeTCP, ProbeTarget: "db:5432"},
		{Name: "cache", ProbeKind: ProbeTCP, ProbeTarget: "cache:6379"},
		{Name: "api", ProbeKind: ProbeHTTP, ProbeTarget: "http://api/healthz", DependsOn: []string{"db", "cache"}},
		{Name: "web", ProbeKind: ProbeHTTP, ProbeTarget: "http://web/healthz", DependsOn: []string{"api"}},
	})
	if err != nil {
		t.Fatalf("DefineServices: %v", err)
	}
	want := [][]string{{"cache", "db"}, {"api"}, {"web"}}
	if got := plan.ServiceNames(); !equalTiers(got, want) {
		t.Fatalf("tiers = %v, want %v", got, want)
	}
	if !stager.has(eventServicesDefined) {
		t.Error("expected services.defined event staged")
	}
}

func TestService_DefineServices_RejectsCycle(t *testing.T) {
	store := newFakeStore()
	store.groups["g1"] = true
	svc := newTestService(t, store, &recordingStager{}, nil)

	_, err := svc.DefineServices(context.Background(), uuid.New(), "g1", []ServiceSpec{
		{Name: "a", ProbeKind: ProbeTCP, ProbeTarget: "a:1", DependsOn: []string{"b"}},
		{Name: "b", ProbeKind: ProbeTCP, ProbeTarget: "b:1", DependsOn: []string{"a"}},
	})
	if !errors.Is(err, ErrCycle) {
		t.Fatalf("err = %v, want ErrCycle", err)
	}
	// Nothing should have been persisted as a dependency on rejection.
	if len(store.deps["g1"]) != 0 {
		t.Fatalf("deps persisted on cycle rejection: %v", store.deps["g1"])
	}
}

func TestService_DefineServices_RejectsUnknownDependency(t *testing.T) {
	store := newFakeStore()
	store.groups["g1"] = true
	svc := newTestService(t, store, &recordingStager{}, nil)
	_, err := svc.DefineServices(context.Background(), uuid.New(), "g1", []ServiceSpec{
		{Name: "api", ProbeKind: ProbeTCP, ProbeTarget: "api:1", DependsOn: []string{"ghost"}},
	})
	if !errors.Is(err, ErrUnknownDependency) {
		t.Fatalf("err = %v, want ErrUnknownDependency", err)
	}
}

func TestService_DefineServices_GroupNotFound(t *testing.T) {
	store := newFakeStore() // no group registered
	svc := newTestService(t, store, &recordingStager{}, nil)
	_, err := svc.DefineServices(context.Background(), uuid.New(), "missing", []ServiceSpec{
		{Name: "a", ProbeKind: ProbeTCP, ProbeTarget: "a:1"},
	})
	if !errors.Is(err, ErrGroupNotFound) {
		t.Fatalf("err = %v, want ErrGroupNotFound", err)
	}
}

func TestService_StartRun_AllHealthyCompletes(t *testing.T) {
	store := newFakeStore()
	store.groups["g1"] = true
	stager := &recordingStager{}
	svc := newTestService(t, store, stager, func(Service) HealthChecker { return scriptedChecker{} })

	if _, err := svc.DefineServices(context.Background(), uuid.New(), "g1", []ServiceSpec{
		{Name: "db", ProbeKind: ProbeTCP, ProbeTarget: "db:1"},
		{Name: "api", ProbeKind: ProbeTCP, ProbeTarget: "api:1", DependsOn: []string{"db"}},
	}); err != nil {
		t.Fatalf("DefineServices: %v", err)
	}

	detail, err := svc.StartRun(context.Background(), uuid.New(), "g1", PolicyHalt, nil)
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}
	if detail.Run.Status != RunStatusCompleted {
		t.Fatalf("run status = %q, want completed", detail.Run.Status)
	}
	if detail.Run.TiersBooted != 2 {
		t.Fatalf("tiers booted = %d, want 2", detail.Run.TiersBooted)
	}
	for _, s := range detail.Services {
		if s.Status != SvcHealthy {
			t.Errorf("service %s status = %s, want healthy", s.ServiceName, s.Status)
		}
	}
	if !stager.has(eventRunCompleted) {
		t.Error("expected run.completed event staged")
	}
}

func TestService_StartRun_TierFailureHalts(t *testing.T) {
	store := newFakeStore()
	store.groups["g1"] = true
	stager := &recordingStager{}

	// api (tier 1) is unhealthy. We need its stored service ID to script the
	// checker; capture it by inspecting the store after DefineServices.
	svc := newTestService(t, store, stager, nil) // checker set after we know the ID

	tenant := uuid.New()
	if _, err := svc.DefineServices(context.Background(), tenant, "g1", []ServiceSpec{
		{Name: "db", ProbeKind: ProbeTCP, ProbeTarget: "db:1"},
		{Name: "api", ProbeKind: ProbeTCP, ProbeTarget: "api:1", DependsOn: []string{"db"}},
	}); err != nil {
		t.Fatalf("DefineServices: %v", err)
	}

	var apiID string
	for _, s := range store.services["g1"] {
		if s.Name == "api" {
			apiID = s.ID
		}
	}
	if apiID == "" {
		t.Fatal("could not find api service ID")
	}

	// Rebuild the service with a checker that fails api.
	failing := func(Service) HealthChecker {
		return scriptedChecker{results: map[string]error{apiID: errors.New("api down")}}
	}
	svc2 := newTestService(t, store, stager, failing)

	detail, err := svc2.StartRun(context.Background(), tenant, "g1", PolicyHalt, nil)
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}
	if detail.Run.Status != RunStatusFailed {
		t.Fatalf("run status = %q, want failed", detail.Run.Status)
	}
	if detail.Run.TiersBooted != 1 {
		t.Fatalf("tiers booted = %d, want 1", detail.Run.TiersBooted)
	}
	if !stager.has(eventRunFailed) {
		t.Error("expected run.failed event staged")
	}
}

func TestService_StartRun_NoServices(t *testing.T) {
	store := newFakeStore()
	store.groups["g1"] = true
	svc := newTestService(t, store, &recordingStager{}, nil)
	if _, err := svc.StartRun(context.Background(), uuid.New(), "g1", PolicyHalt, nil); !errors.Is(err, ErrNoServices) {
		t.Fatalf("err = %v, want ErrNoServices", err)
	}
}

func TestService_GetPlan(t *testing.T) {
	store := newFakeStore()
	store.groups["g1"] = true
	svc := newTestService(t, store, &recordingStager{}, nil)
	if _, err := svc.DefineServices(context.Background(), uuid.New(), "g1", []ServiceSpec{
		{Name: "db", ProbeKind: ProbeTCP, ProbeTarget: "db:1"},
		{Name: "api", ProbeKind: ProbeTCP, ProbeTarget: "api:1", DependsOn: []string{"db"}},
	}); err != nil {
		t.Fatalf("DefineServices: %v", err)
	}
	plan, err := svc.GetPlan(context.Background(), uuid.New(), "g1")
	if err != nil {
		t.Fatalf("GetPlan: %v", err)
	}
	want := [][]string{{"db"}, {"api"}}
	if got := plan.ServiceNames(); !equalTiers(got, want) {
		t.Fatalf("tiers = %v, want %v", got, want)
	}
}

func TestNewService_Validation(t *testing.T) {
	if _, err := NewService(Config{Runner: fakeRunner{}}); err == nil {
		t.Error("expected error when store is nil")
	}
	if _, err := NewService(Config{Store: newFakeStore()}); err == nil {
		t.Error("expected error when runner is nil")
	}
}

func equalTiers(a, b [][]string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if !equalStrings(a[i], b[i]) {
			return false
		}
	}
	return true
}
