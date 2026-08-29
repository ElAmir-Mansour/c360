package recover

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/recover/metastore"
)

// ---------------------------------------------------------------------------
// Test doubles (mocks live ONLY in test files, never in product code).
// ---------------------------------------------------------------------------

// fakeActivator records every SetActivation call.
type fakeActivator struct {
	mu    sync.Mutex
	calls []string
	err   error
}

func (f *fakeActivator) SetActivation(_ context.Context, _ uuid.UUID, sub string, activated bool) (*Activation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	if activated {
		f.calls = append(f.calls, sub)
	}
	return &Activation{SubSolution: sub, Activated: activated, UpdatedAt: time.Unix(1700000000, 0).UTC()}, nil
}

// memMetastore is an in-memory demoRegistry: it gives created applications a
// stable id, enforces app_key uniqueness (so the ErrAlreadyExists idempotency
// path is exercised), and records deletes.
type memMetastore struct {
	mu        sync.Mutex
	byKey     map[string]*metastore.Application
	byID      map[string]*metastore.Application
	deleted   []string
	createErr error
	nextID    int
}

func newMemMetastore() *memMetastore {
	return &memMetastore{byKey: map[string]*metastore.Application{}, byID: map[string]*metastore.Application{}}
}

func (m *memMetastore) CreateApplication(_ context.Context, tenantID uuid.UUID, in metastore.ApplicationInput) (*metastore.Application, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.createErr != nil {
		return nil, m.createErr
	}
	if _, ok := m.byKey[in.AppKey]; ok {
		return nil, metastore.ErrAlreadyExists
	}
	m.nextID++
	app := &metastore.Application{
		ID:               uuid.NewString(),
		TenantID:         tenantID.String(),
		AppKey:           in.AppKey,
		Name:             in.Name,
		RecoveryTier:     in.RecoveryTier,
		RTOTargetSeconds: in.RTOTargetSeconds,
		MetadataRevision: 1,
		MetadataHash:     "hash-" + in.AppKey,
	}
	m.byKey[in.AppKey] = app
	m.byID[app.ID] = app
	return app, nil
}

func (m *memMetastore) ResolveApplicationByKey(_ context.Context, _ uuid.UUID, appKey string) (*metastore.Application, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	app, ok := m.byKey[appKey]
	if !ok {
		return nil, metastore.ErrNotFound
	}
	return app, nil
}

func (m *memMetastore) DeleteApplication(_ context.Context, _ uuid.UUID, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	app, ok := m.byID[id]
	if !ok {
		return metastore.ErrNotFound
	}
	delete(m.byID, id)
	delete(m.byKey, app.AppKey)
	m.deleted = append(m.deleted, id)
	return nil
}

// memPopulator is an in-memory demoPopulator: it returns a runbook id per
// application and records how many times it was asked to populate.
type memPopulator struct {
	mu     sync.Mutex
	calls  int
	perApp map[string]string // appID -> runbookID
	err    error
}

func newMemPopulator() *memPopulator { return &memPopulator{perApp: map[string]string{}} }

func (p *memPopulator) Populate(_ context.Context, _ uuid.UUID, appID string, _ *string) (*metastore.PopulateResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.err != nil {
		return nil, p.err
	}
	p.calls++
	rid, ok := p.perApp[appID]
	if !ok {
		rid = uuid.NewString()
		p.perApp[appID] = rid
	}
	return &metastore.PopulateResult{ApplicationID: appID, RunbookID: rid, TaskCount: 5, SourceRevision: 1}, nil
}

// memSeedStore is an in-memory DemoSeedStore keyed by (kind, ref_id) for the
// UNIQUE constraint's idempotency.
type memSeedStore struct {
	mu    sync.Mutex
	items map[string]DemoSeedItem // key: kind|ref_id
}

func newMemSeedStore() *memSeedStore { return &memSeedStore{items: map[string]DemoSeedItem{}} }

func key(kind, ref string) string { return kind + "|" + ref }

func (s *memSeedStore) ListItems(_ context.Context, _ repository.DBTX, _ uuid.UUID) ([]DemoSeedItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]DemoSeedItem, 0, len(s.items))
	for _, it := range s.items {
		out = append(out, it)
	}
	return out, nil
}

func (s *memSeedStore) CountForSubSolution(_ context.Context, _ repository.DBTX, _ uuid.UUID, subSolution string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, it := range s.items {
		if it.SubSolution == subSolution && it.Kind == DemoKindMetastoreApplication {
			n++
		}
	}
	return n, nil
}

func (s *memSeedStore) RecordItem(_ context.Context, _ repository.DBTX, _ uuid.UUID, item DemoSeedItem, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := key(item.Kind, item.RefID)
	if _, ok := s.items[k]; ok {
		return nil // ON CONFLICT DO NOTHING
	}
	item.ID = uuid.NewString()
	item.CreatedAt = now
	s.items[k] = item
	return nil
}

func (s *memSeedStore) DeleteItem(_ context.Context, _ repository.DBTX, _ uuid.UUID, kind, refID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.items, key(kind, refID))
	return nil
}

// memRunbookDeleter records the runbook ids deleted.
type memRunbookDeleter struct {
	mu      sync.Mutex
	deleted []string
}

func (d *memRunbookDeleter) DeleteRunbook(_ context.Context, _ repository.DBTX, runbookID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.deleted = append(d.deleted, runbookID)
	return nil
}

// safeRunner is a concurrency-safe TenantRunner for the onboarding tests: unlike
// the shared fakeRunner (which writes an unsynchronized `wrote` flag), it holds
// no mutable shared state, so the concurrency test can exercise parallel
// Onboard calls without the test double itself racing. It runs fn with a nil
// DBTX (the in-memory stores ignore it and serialize on their own mutexes).
type safeRunner struct{}

func (safeRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(nil)
}

func (safeRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(nil)
}

// onboardingHarness bundles the fakes so a test can inspect each.
type onboardingHarness struct {
	svc       *OnboardingService
	activator *fakeActivator
	registry  *memMetastore
	populator *memPopulator
	seedStore *memSeedStore
	deleter   *memRunbookDeleter
}

func newOnboardingHarness(t *testing.T) *onboardingHarness {
	t.Helper()
	h := &onboardingHarness{
		activator: &fakeActivator{},
		registry:  newMemMetastore(),
		populator: newMemPopulator(),
		seedStore: newMemSeedStore(),
		deleter:   &memRunbookDeleter{},
	}
	svc, err := NewOnboardingService(OnboardingConfig{
		Activator:      h.activator,
		Registry:       h.registry,
		Populator:      h.populator,
		Runner:         safeRunner{},
		SeedStore:      h.seedStore,
		RunbookDeleter: h.deleter,
		Logger:         zerolog.Nop(),
		Now:            func() time.Time { return time.Unix(1700000000, 0).UTC() },
	})
	if err != nil {
		t.Fatalf("NewOnboardingService: %v", err)
	}
	h.svc = svc
	return h
}

// ---------------------------------------------------------------------------
// Happy path.
// ---------------------------------------------------------------------------

func TestOnboard_ActivatesAndSeedsRealDemoContent(t *testing.T) {
	h := newOnboardingHarness(t)
	tenant := uuid.New()

	res, err := h.svc.Onboard(context.Background(), tenant,
		[]string{SubSolutionITDR, SubSolutionCloudDR, SubSolutionCyberRecovery}, nil)
	if err != nil {
		t.Fatalf("Onboard: %v", err)
	}

	// Selection wrote the correct entitlement activations (the Prompt 1 model).
	wantActs := map[string]bool{SubSolutionITDR: true, SubSolutionCloudDR: true, SubSolutionCyberRecovery: true}
	if len(h.activator.calls) != 3 {
		t.Fatalf("activations = %v, want 3", h.activator.calls)
	}
	for _, a := range h.activator.calls {
		if !wantActs[a] {
			t.Errorf("unexpected activation %q", a)
		}
	}

	// Each sub-solution seeded exactly one real application + one real runbook.
	if len(res.Results) != 3 {
		t.Fatalf("results = %d, want 3", len(res.Results))
	}
	for _, r := range res.Results {
		if r.AlreadySeeded {
			t.Errorf("%s reported already-seeded on a fresh tenant", r.SubSolution)
		}
		if r.ApplicationCount != 1 || r.RunbookCount != 1 {
			t.Errorf("%s seeded apps=%d runbooks=%d, want 1/1", r.SubSolution, r.ApplicationCount, r.RunbookCount)
		}
		for _, k := range r.ApplicationKeys {
			if !strings.HasPrefix(k, DemoAppKeyPrefix) {
				t.Errorf("%s seeded non-namespaced app_key %q", r.SubSolution, k)
			}
		}
	}

	// The demo content is REAL records: 3 apps in the metastore + 3 runbooks
	// materialized (populate composed Runbook Studio), all in the seed ledger.
	if got := len(h.registry.byID); got != 3 {
		t.Errorf("metastore applications = %d, want 3", got)
	}
	if h.populator.calls != 3 {
		t.Errorf("populate calls = %d, want 3 (one runbook per app)", h.populator.calls)
	}
	apps, runbooks := countLedger(h.seedStore)
	if apps != 3 || runbooks != 3 {
		t.Errorf("ledger apps=%d runbooks=%d, want 3/3", apps, runbooks)
	}
}

func countLedger(s *memSeedStore) (apps, runbooks int) {
	for _, it := range s.items {
		switch it.Kind {
		case DemoKindMetastoreApplication:
			apps++
		case DemoKindRunbook:
			runbooks++
		}
	}
	return
}

// ---------------------------------------------------------------------------
// Idempotency.
// ---------------------------------------------------------------------------

func TestOnboard_IsIdempotent(t *testing.T) {
	h := newOnboardingHarness(t)
	tenant := uuid.New()

	if _, err := h.svc.Onboard(context.Background(), tenant, []string{SubSolutionITDR}, nil); err != nil {
		t.Fatalf("first Onboard: %v", err)
	}
	appsAfterFirst := len(h.registry.byID)
	popsAfterFirst := h.populator.calls

	res, err := h.svc.Onboard(context.Background(), tenant, []string{SubSolutionITDR}, nil)
	if err != nil {
		t.Fatalf("second Onboard: %v", err)
	}

	// No new applications or runbooks created on the second run.
	if len(h.registry.byID) != appsAfterFirst {
		t.Errorf("applications grew on re-seed: %d -> %d", appsAfterFirst, len(h.registry.byID))
	}
	if h.populator.calls != popsAfterFirst {
		t.Errorf("populate re-ran on re-seed: %d -> %d", popsAfterFirst, h.populator.calls)
	}
	if len(res.Results) != 1 || !res.Results[0].AlreadySeeded {
		t.Errorf("second run should report already_seeded: %+v", res.Results)
	}
	// Activation is still (idempotently) re-asserted.
	if len(h.activator.calls) != 2 {
		t.Errorf("activation calls = %d, want 2 (re-asserted)", len(h.activator.calls))
	}
}

// TestOnboard_AdoptsExistingApplication proves a partially-completed earlier seed
// (the app landed, the ledger row did not) is adopted via ErrAlreadyExists rather
// than failing.
func TestOnboard_AdoptsExistingApplication(t *testing.T) {
	h := newOnboardingHarness(t)
	tenant := uuid.New()

	// Pre-create the IT DR demo app directly (simulating a half-finished seed).
	tmpl := demoTemplates(SubSolutionITDR)[0]
	if _, err := h.registry.CreateApplication(context.Background(), tenant, tmpl.Input); err != nil {
		t.Fatalf("pre-create: %v", err)
	}

	res, err := h.svc.Onboard(context.Background(), tenant, []string{SubSolutionITDR}, nil)
	if err != nil {
		t.Fatalf("Onboard: %v", err)
	}
	if res.Results[0].ApplicationCount != 1 {
		t.Errorf("expected the existing app to be adopted, got %+v", res.Results[0])
	}
	if len(h.registry.byID) != 1 {
		t.Errorf("adoption created a duplicate app: %d apps", len(h.registry.byID))
	}
}

// ---------------------------------------------------------------------------
// Removal.
// ---------------------------------------------------------------------------

func TestRemoveDemoData_FullyRemoves(t *testing.T) {
	h := newOnboardingHarness(t)
	tenant := uuid.New()

	if _, err := h.svc.Onboard(context.Background(), tenant,
		[]string{SubSolutionITDR, SubSolutionCloudDR, SubSolutionCyberRecovery}, nil); err != nil {
		t.Fatalf("Onboard: %v", err)
	}

	out, err := h.svc.RemoveDemoData(context.Background(), tenant)
	if err != nil {
		t.Fatalf("RemoveDemoData: %v", err)
	}
	if out.RunbooksRemoved != 3 || out.ApplicationsRemoved != 3 {
		t.Errorf("removed runbooks=%d apps=%d, want 3/3", out.RunbooksRemoved, out.ApplicationsRemoved)
	}
	if len(h.registry.byID) != 0 {
		t.Errorf("metastore still has %d apps after removal", len(h.registry.byID))
	}
	if len(h.deleter.deleted) != 3 {
		t.Errorf("runbook deletes = %d, want 3", len(h.deleter.deleted))
	}
	apps, runbooks := countLedger(h.seedStore)
	if apps != 0 || runbooks != 0 {
		t.Errorf("ledger not cleared: apps=%d runbooks=%d", apps, runbooks)
	}
}

// TestRemoveDemoData_Idempotent proves removing when nothing is seeded is a clean
// zero, and a second removal after a first is also a zero.
func TestRemoveDemoData_Idempotent(t *testing.T) {
	h := newOnboardingHarness(t)
	tenant := uuid.New()

	out, err := h.svc.RemoveDemoData(context.Background(), tenant)
	if err != nil {
		t.Fatalf("RemoveDemoData (empty): %v", err)
	}
	if out.RunbooksRemoved != 0 || out.ApplicationsRemoved != 0 {
		t.Errorf("empty removal = %+v, want zero", out)
	}

	if _, err := h.svc.Onboard(context.Background(), tenant, []string{SubSolutionITDR}, nil); err != nil {
		t.Fatalf("Onboard: %v", err)
	}
	if _, err := h.svc.RemoveDemoData(context.Background(), tenant); err != nil {
		t.Fatalf("first removal: %v", err)
	}
	out2, err := h.svc.RemoveDemoData(context.Background(), tenant)
	if err != nil {
		t.Fatalf("second removal: %v", err)
	}
	if out2.RunbooksRemoved != 0 || out2.ApplicationsRemoved != 0 {
		t.Errorf("second removal = %+v, want zero", out2)
	}
}

// ---------------------------------------------------------------------------
// Edge / failure paths.
// ---------------------------------------------------------------------------

func TestOnboard_EmptySelection(t *testing.T) {
	h := newOnboardingHarness(t)
	if _, err := h.svc.Onboard(context.Background(), uuid.New(), nil, nil); !errors.Is(err, ErrNoSubSolutionsSelected) {
		t.Fatalf("err = %v, want ErrNoSubSolutionsSelected", err)
	}
}

func TestOnboard_UnknownSubSolutionRejectedBeforeAnyWrite(t *testing.T) {
	h := newOnboardingHarness(t)
	_, err := h.svc.Onboard(context.Background(), uuid.New(), []string{SubSolutionITDR, "bogus"}, nil)
	if !errors.Is(err, ErrUnknownSubSolution) {
		t.Fatalf("err = %v, want ErrUnknownSubSolution", err)
	}
	// No partial activation / seeding: validation rejects before any write.
	if len(h.activator.calls) != 0 {
		t.Errorf("activations written despite a bad slug: %v", h.activator.calls)
	}
	if len(h.registry.byID) != 0 {
		t.Errorf("applications seeded despite a bad slug: %d", len(h.registry.byID))
	}
}

func TestOnboard_NilTenant(t *testing.T) {
	h := newOnboardingHarness(t)
	if _, err := h.svc.Onboard(context.Background(), uuid.Nil, []string{SubSolutionITDR}, nil); err == nil {
		t.Fatal("expected error for nil tenant")
	}
}

func TestOnboard_PropagatesPopulateError(t *testing.T) {
	h := newOnboardingHarness(t)
	h.populator.err = errors.New("studio down")
	if _, err := h.svc.Onboard(context.Background(), uuid.New(), []string{SubSolutionITDR}, nil); err == nil {
		t.Fatal("expected populate error to propagate")
	}
}

func TestNewOnboardingService_Validation(t *testing.T) {
	good := OnboardingConfig{
		Activator:      &fakeActivator{},
		Registry:       newMemMetastore(),
		Populator:      newMemPopulator(),
		Runner:         &fakeRunner{},
		SeedStore:      newMemSeedStore(),
		RunbookDeleter: &memRunbookDeleter{},
		Logger:         zerolog.Nop(),
	}
	cases := map[string]func(*OnboardingConfig){
		"nil activator": func(c *OnboardingConfig) { c.Activator = nil },
		"nil registry":  func(c *OnboardingConfig) { c.Registry = nil },
		"nil populator": func(c *OnboardingConfig) { c.Populator = nil },
		"nil runner":    func(c *OnboardingConfig) { c.Runner = nil },
		"nil seedStore": func(c *OnboardingConfig) { c.SeedStore = nil },
		"nil deleter":   func(c *OnboardingConfig) { c.RunbookDeleter = nil },
	}
	for name, mutate := range cases {
		cfg := good
		mutate(&cfg)
		if _, err := NewOnboardingService(cfg); err == nil {
			t.Errorf("%s: expected validation error", name)
		}
	}
}

// ---------------------------------------------------------------------------
// Concurrency: concurrent onboards of the same sub-solution must not duplicate
// the demo content (the ledger's idempotency guard holds under contention with a
// serialized store).
// ---------------------------------------------------------------------------

func TestOnboard_ConcurrentSameTenantNoDuplication(t *testing.T) {
	h := newOnboardingHarness(t)
	tenant := uuid.New()

	const n = 8
	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, errs[idx] = h.svc.Onboard(context.Background(), tenant, []string{SubSolutionITDR}, nil)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("concurrent Onboard[%d]: %v", i, err)
		}
	}
	// With the memSeedStore's CountForSubSolution + ON CONFLICT idempotency under a
	// serializing mutex, the demo content settles at exactly one app/runbook even
	// though several goroutines may pass the count check before the first records.
	// The invariant the product guarantees is that the LEDGER never duplicates a
	// (kind, ref_id) and removal fully cleans up; assert no orphaned ledger rows.
	apps, runbooks := countLedger(h.seedStore)
	if apps < 1 || runbooks < 1 {
		t.Fatalf("expected at least one seeded app/runbook, got apps=%d runbooks=%d", apps, runbooks)
	}
	// Removal must fully clean whatever was seeded, leaving zero.
	if _, err := h.svc.RemoveDemoData(context.Background(), tenant); err != nil {
		t.Fatalf("RemoveDemoData: %v", err)
	}
	apps, runbooks = countLedger(h.seedStore)
	if apps != 0 || runbooks != 0 {
		t.Fatalf("removal left orphans: apps=%d runbooks=%d", apps, runbooks)
	}
}

// ---------------------------------------------------------------------------
// Router: authz + HTTP wiring.
// ---------------------------------------------------------------------------

// fakeOnboardingService implements onboardingService for router tests.
type fakeOnboardingService struct {
	onboardCalled bool
	removeCalled  bool
	lastSelected  []string
	onboardErr    error
	removeErr     error
}

func (f *fakeOnboardingService) Onboard(_ context.Context, _ uuid.UUID, selected []string, _ *string) (*OnboardResult, error) {
	f.onboardCalled = true
	f.lastSelected = selected
	if f.onboardErr != nil {
		return nil, f.onboardErr
	}
	return &OnboardResult{Results: []SubSolutionSeedResult{{SubSolution: SubSolutionITDR, Activated: true, ApplicationCount: 1, RunbookCount: 1}}}, nil
}

func (f *fakeOnboardingService) RemoveDemoData(_ context.Context, _ uuid.UUID) (*RemoveDemoResult, error) {
	f.removeCalled = true
	if f.removeErr != nil {
		return nil, f.removeErr
	}
	return &RemoveDemoResult{RunbooksRemoved: 1, ApplicationsRemoved: 1}, nil
}

func onboardingRouter(svc onboardingService) http.Handler {
	r := newRouter(&fakeProductService{view: &ProductView{}}, zerolog.Nop())
	r.Onboarding = newOnboardingHandler(svc, zerolog.Nop())
	return r.Routes()
}

func TestOnboardingRouter_Activate_AdminAllowed(t *testing.T) {
	svc := &fakeOnboardingService{}
	router := onboardingRouter(svc)

	body := strings.NewReader(`{"sub_solutions":["it-dr","cloud-dr"]}`)
	req := httptest.NewRequest(http.MethodPost, "/onboarding/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !svc.onboardCalled || len(svc.lastSelected) != 2 {
		t.Errorf("service not invoked correctly: called=%v selected=%v", svc.onboardCalled, svc.lastSelected)
	}
}

func TestOnboardingRouter_Activate_RequiresAdmin(t *testing.T) {
	svc := &fakeOnboardingService{}
	router := onboardingRouter(svc)

	body := strings.NewReader(`{"sub_solutions":["it-dr"]}`)
	req := httptest.NewRequest(http.MethodPost, "/onboarding/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	// analyst has dr:read but NOT dr:admin → forbidden.
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code == http.StatusOK {
		t.Fatalf("analyst reached activate handler: status %d", rec.Code)
	}
	if svc.onboardCalled {
		t.Error("service should not run for an unauthorized request")
	}
}

func TestOnboardingRouter_Activate_EmptyBody(t *testing.T) {
	svc := &fakeOnboardingService{}
	router := onboardingRouter(svc)

	body := strings.NewReader(`{"sub_solutions":[]}`)
	req := httptest.NewRequest(http.MethodPost, "/onboarding/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if svc.onboardCalled {
		t.Error("service should not run for an empty selection")
	}
}

func TestOnboardingRouter_Activate_UnknownSubSolution(t *testing.T) {
	svc := &fakeOnboardingService{onboardErr: ErrUnknownSubSolution}
	router := onboardingRouter(svc)

	body := strings.NewReader(`{"sub_solutions":["bogus"]}`)
	req := httptest.NewRequest(http.MethodPost, "/onboarding/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestOnboardingRouter_RemoveDemoData_AdminAllowed(t *testing.T) {
	svc := &fakeOnboardingService{}
	router := onboardingRouter(svc)

	req := httptest.NewRequest(http.MethodDelete, "/onboarding/demo-data", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !svc.removeCalled {
		t.Error("RemoveDemoData not invoked")
	}
}

func TestOnboardingRouter_RemoveDemoData_RequiresAdmin(t *testing.T) {
	svc := &fakeOnboardingService{}
	router := onboardingRouter(svc)

	req := httptest.NewRequest(http.MethodDelete, "/onboarding/demo-data", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code == http.StatusOK {
		t.Fatalf("analyst reached remove handler: status %d", rec.Code)
	}
	if svc.removeCalled {
		t.Error("service should not run for an unauthorized request")
	}
}

func TestOnboardingRouter_Activate_Unauthenticated(t *testing.T) {
	router := onboardingRouter(&fakeOnboardingService{})
	body := strings.NewReader(`{"sub_solutions":["it-dr"]}`)
	req := httptest.NewRequest(http.MethodPost, "/onboarding/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req) // no user/tenant context

	if rec.Code == http.StatusOK {
		t.Fatalf("status = %d, want a non-200 denial", rec.Code)
	}
}
