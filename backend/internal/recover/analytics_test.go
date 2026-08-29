package recover

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/recover/metastore"
)

// --- fakes (mocks live only in test files; never a source of truth) ----------

// fakeAnalyticsMetastore is an in-memory AnalyticsMetastore. It records the
// list args so a test can prove the seam is the RTO source.
type fakeAnalyticsMetastore struct {
	page metastore.ListPage
	err  error

	mu        sync.Mutex
	gotLimit  int
	gotOffset int
}

func (f *fakeAnalyticsMetastore) ListApplications(_ context.Context, _ uuid.UUID, limit, offset int) (metastore.ListPage, error) {
	f.mu.Lock()
	f.gotLimit, f.gotOffset = limit, offset
	f.mu.Unlock()
	return f.page, f.err
}

// fakeAnalyticsStore is an in-memory AnalyticsStore. It returns canned events and
// trend points and RECORDS every appended snapshot so a test can assert the
// append-only readiness trend grows and is never mutated.
type fakeAnalyticsStore struct {
	events map[string][]RecoveryEvent
	trend  []ReadinessTrendPoint
	err    error

	mu       sync.Mutex
	appended []ReadinessSnapshot
	gotLinks map[string][]string
	gotPer   int
}

func (f *fakeAnalyticsStore) RecoveryEventsForApplications(_ context.Context, _ repository.DBTX, links map[string][]string, perApp int) (map[string][]RecoveryEvent, error) {
	f.mu.Lock()
	f.gotLinks = links
	f.gotPer = perApp
	f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	return f.events, nil
}

func (f *fakeAnalyticsStore) AppendReadinessSnapshot(_ context.Context, _ repository.DBTX, _ uuid.UUID, snap ReadinessSnapshot, _ time.Time) error {
	if f.err != nil {
		return f.err
	}
	f.mu.Lock()
	f.appended = append(f.appended, snap)
	f.mu.Unlock()
	return nil
}

func (f *fakeAnalyticsStore) ReadinessTrend(_ context.Context, _ repository.DBTX, _ time.Time, _ int) ([]ReadinessTrendPoint, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.trend, nil
}

func (f *fakeAnalyticsStore) appendedCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.appended)
}

// concurrentRunner is a stateless TenantRunner for the concurrency test: it runs
// fn with a nil DBTX and records nothing, so many goroutines may share one
// service without racing on a fake's bookkeeping field. The product code under
// test (AnalyticsService) holds no per-request mutable state; this runner just
// avoids the shared-fake write the single-threaded fakeRunner records.
type concurrentRunner struct{}

func (concurrentRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(nil)
}
func (concurrentRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(nil)
}

func ptr(n int) *int { return &n }

// app builds a Metastore application with one linked runbook id.
func app(id, key, name, tier string, rto int, runbookID string) metastore.Application {
	return metastore.Application{
		ID:               id,
		AppKey:           key,
		Name:             name,
		RecoveryTier:     tier,
		RTOTargetSeconds: rto,
		LinkedRunbooks:   []metastore.RunbookLink{{RunbookID: runbookID}},
	}
}

func newAnalyticsService(t *testing.T, ms AnalyticsMetastore, store AnalyticsStore, resolver EntitlementResolver, now time.Time) *AnalyticsService {
	t.Helper()
	svc, err := NewAnalyticsService(AnalyticsConfig{
		Runner:       &fakeRunner{},
		Metastore:    ms,
		Store:        store,
		Entitlements: resolver,
		Logger:       zerolog.Nop(),
		Now:          func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewAnalyticsService: %v", err)
	}
	return svc
}

// --- happy path ---------------------------------------------------------------

func TestAnalytics_HappyPath_RTOvsRTA(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	rbA, rbB := uuid.NewString(), uuid.NewString()
	idA, idB := uuid.NewString(), uuid.NewString()
	ms := &fakeAnalyticsMetastore{page: metastore.ListPage{
		Applications: []metastore.Application{
			app(idA, "core-banking", "Core Banking", metastore.TierMissionCritical, 600, rbA), // RTO 600s
			app(idB, "ledger", "Ledger", metastore.TierTwo, 1800, rbB),                        // RTO 1800s
		},
		Total: 2,
	}}
	store := &fakeAnalyticsStore{
		events: map[string][]RecoveryEvent{
			// Core Banking: latest completed RTA = 900s > 600s target → BREACH.
			idA: {{EventID: uuid.NewString(), Source: AnalyticsSourceRunbookRun, Status: "completed", Succeeded: true, RTAActualSecond: ptr(900), StartedAt: now.Add(-time.Hour)}},
			// Ledger: latest completed RTA = 1200s <= 1800s target → within target.
			idB: {{EventID: uuid.NewString(), Source: AnalyticsSourceRunbookRun, Status: "completed", Succeeded: true, RTAActualSecond: ptr(1200), StartedAt: now.Add(-2 * time.Hour)}},
		},
	}
	resolver := &stubResolver{active: map[string]bool{EntitlementITDR: true}}
	svc := newAnalyticsService(t, ms, store, resolver, now)

	view, err := svc.Analytics(context.Background(), uuid.New(), "Bearer t")
	if err != nil {
		t.Fatalf("Analytics: %v", err)
	}

	// RTO came from the Metastore seam (the scan limit/offset were forwarded).
	if ms.gotLimit != analyticsAppScanLimit || ms.gotOffset != 0 {
		t.Errorf("metastore list args = (%d,%d)", ms.gotLimit, ms.gotOffset)
	}
	// The RTA read was keyed by the Metastore runbook links.
	if got := store.gotLinks[idA]; len(got) != 1 || got[0] != rbA {
		t.Errorf("link map for A = %v, want [%s]", got, rbA)
	}
	if store.gotPer != analyticsEventWindow {
		t.Errorf("per-app window = %d, want %d", store.gotPer, analyticsEventWindow)
	}

	if len(view.Applications) != 2 {
		t.Fatalf("applications = %d, want 2", len(view.Applications))
	}
	// Applications are sorted by ascending readiness (worst first): the breaching
	// Core Banking should rank before the in-target Ledger.
	byKey := map[string]ApplicationAnalytics{}
	for _, a := range view.Applications {
		byKey[a.AppKey] = a
	}
	cb := byKey["core-banking"]
	if cb.RTOTargetSeconds != 600 || cb.LatestRTASeconds == nil || *cb.LatestRTASeconds != 900 {
		t.Errorf("core-banking RTO/RTA = %d / %v", cb.RTOTargetSeconds, cb.LatestRTASeconds)
	}
	if !cb.RTABreach || cb.BreachSeconds != 300 {
		t.Errorf("core-banking breach = %v / %d, want true / 300", cb.RTABreach, cb.BreachSeconds)
	}
	led := byKey["ledger"]
	if led.RTABreach {
		t.Errorf("ledger should be within target")
	}

	// Progress: 1 recovered (ledger), 1 at-risk (core-banking), 0 untested.
	if view.Progress.Recovered != 1 || view.Progress.AtRisk != 1 || view.Progress.Untested != 0 {
		t.Errorf("progress = %+v", view.Progress)
	}
	if view.Progress.CompletionRatio != 0.5 {
		t.Errorf("completion ratio = %v, want 0.5", view.Progress.CompletionRatio)
	}

	// A breach produces a bottleneck.
	foundBreach := false
	for _, b := range view.Bottlenecks {
		if b.Kind == bottleneckBreach && b.AppKey == "core-banking" {
			foundBreach = true
		}
	}
	if !foundBreach {
		t.Errorf("expected an rto_breach bottleneck for core-banking; got %+v", view.Bottlenecks)
	}

	// The readiness snapshot was appended (append-only trend grows) and the live
	// point is at the head of the returned trend.
	if store.appendedCount() != 1 {
		t.Errorf("expected 1 appended snapshot, got %d", store.appendedCount())
	}
	if len(view.ReadinessTrend) == 0 || !view.ReadinessTrend[0].CapturedAt.Equal(now) {
		t.Errorf("expected live trend head at %v, got %+v", now, view.ReadinessTrend)
	}
	if !view.GeneratedAt.Equal(now) {
		t.Errorf("generated_at = %v", view.GeneratedAt)
	}
}

// --- edge: untested application ----------------------------------------------

func TestAnalytics_UntestedCriticalApplication(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	id := uuid.NewString()
	ms := &fakeAnalyticsMetastore{page: metastore.ListPage{
		Applications: []metastore.Application{app(id, "payments", "Payments", metastore.TierMissionCritical, 300, uuid.NewString())},
		Total:        1,
	}}
	store := &fakeAnalyticsStore{events: map[string][]RecoveryEvent{}} // no events
	resolver := &stubResolver{active: map[string]bool{EntitlementCloudDR: true}}
	svc := newAnalyticsService(t, ms, store, resolver, now)

	view, err := svc.Analytics(context.Background(), uuid.New(), "Bearer t")
	if err != nil {
		t.Fatalf("Analytics: %v", err)
	}
	if view.Progress.Untested != 1 || view.Progress.Recovered != 0 {
		t.Errorf("progress = %+v, want 1 untested", view.Progress)
	}
	if view.Applications[0].LatestRTASeconds != nil {
		t.Errorf("untested app should have no RTA")
	}
	found := false
	for _, b := range view.Bottlenecks {
		if b.Kind == bottleneckUntested && b.AppKey == "payments" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected an untested_application bottleneck; got %+v", view.Bottlenecks)
	}
}

// --- edge: empty estate -------------------------------------------------------

func TestAnalytics_EmptyEstate(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	ms := &fakeAnalyticsMetastore{page: metastore.ListPage{}}
	store := &fakeAnalyticsStore{events: map[string][]RecoveryEvent{}}
	resolver := &stubResolver{active: map[string]bool{EntitlementITDR: true}}
	svc := newAnalyticsService(t, ms, store, resolver, now)

	view, err := svc.Analytics(context.Background(), uuid.New(), "Bearer t")
	if err != nil {
		t.Fatalf("Analytics: %v", err)
	}
	if view.PortfolioReadiness != 0 {
		t.Errorf("empty estate portfolio readiness = %d, want 0", view.PortfolioReadiness)
	}
	if len(view.Applications) != 0 || len(view.Bottlenecks) != 0 {
		t.Errorf("empty estate should have no applications/bottlenecks")
	}
	if view.Applications == nil || view.Bottlenecks == nil {
		t.Errorf("empty slices must marshal as [], not null")
	}
}

// --- authz-denied -------------------------------------------------------------

func TestAnalytics_NotEntitled(t *testing.T) {
	resolver := &stubResolver{active: map[string]bool{}} // no recover.* key licensed
	svc := newAnalyticsService(t, &fakeAnalyticsMetastore{}, &fakeAnalyticsStore{}, resolver, time.Now())

	_, err := svc.Analytics(context.Background(), uuid.New(), "Bearer t")
	if !errors.Is(err, ErrAnalyticsNotEntitled) {
		t.Fatalf("err = %v, want ErrAnalyticsNotEntitled", err)
	}
}

func TestAnalytics_AnySubSolutionGrantsView(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	ms := &fakeAnalyticsMetastore{page: metastore.ListPage{}}
	store := &fakeAnalyticsStore{events: map[string][]RecoveryEvent{}}
	// Only cyber-recovery licensed → portfolio view still authorized.
	resolver := &stubResolver{active: map[string]bool{EntitlementCyberRecovery: true}}
	svc := newAnalyticsService(t, ms, store, resolver, now)

	if _, err := svc.Analytics(context.Background(), uuid.New(), "Bearer t"); err != nil {
		t.Fatalf("Analytics with one sub-solution entitled: %v", err)
	}
}

// --- failure: entitlement outage fails closed --------------------------------

func TestAnalytics_EntitlementUnavailableFailsClosed(t *testing.T) {
	resolver := &stubResolver{err: errors.Join(ErrEntitlementUnavailable, errors.New("outage"))}
	svc := newAnalyticsService(t, &fakeAnalyticsMetastore{}, &fakeAnalyticsStore{}, resolver, time.Now())

	_, err := svc.Analytics(context.Background(), uuid.New(), "Bearer t")
	if !errors.Is(err, ErrEntitlementUnavailable) {
		t.Fatalf("err = %v, want ErrEntitlementUnavailable", err)
	}
}

// --- failure: store/metastore errors propagate -------------------------------

func TestAnalytics_StoreErrorPropagates(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	ms := &fakeAnalyticsMetastore{page: metastore.ListPage{
		Applications: []metastore.Application{app(uuid.NewString(), "a", "A", metastore.TierTwo, 600, uuid.NewString())},
	}}
	store := &fakeAnalyticsStore{err: errors.New("db down")}
	resolver := &stubResolver{active: map[string]bool{EntitlementITDR: true}}
	svc := newAnalyticsService(t, ms, store, resolver, now)

	if _, err := svc.Analytics(context.Background(), uuid.New(), "Bearer t"); err == nil {
		t.Fatal("expected store error to propagate")
	}
}

func TestAnalytics_MetastoreErrorPropagates(t *testing.T) {
	ms := &fakeAnalyticsMetastore{err: errors.New("metastore down")}
	resolver := &stubResolver{active: map[string]bool{EntitlementITDR: true}}
	svc := newAnalyticsService(t, ms, &fakeAnalyticsStore{}, resolver, time.Now())

	if _, err := svc.Analytics(context.Background(), uuid.New(), "Bearer t"); err == nil {
		t.Fatal("expected metastore error to propagate")
	}
}

func TestAnalytics_RequiresTenant(t *testing.T) {
	resolver := &stubResolver{active: map[string]bool{EntitlementITDR: true}}
	svc := newAnalyticsService(t, &fakeAnalyticsMetastore{}, &fakeAnalyticsStore{}, resolver, time.Now())
	if _, err := svc.Analytics(context.Background(), uuid.Nil, "Bearer t"); err == nil {
		t.Fatal("expected error for nil tenant")
	}
}

func TestNewAnalyticsService_Validation(t *testing.T) {
	good := AnalyticsConfig{Runner: &fakeRunner{}, Metastore: &fakeAnalyticsMetastore{}, Store: &fakeAnalyticsStore{}, Entitlements: &stubResolver{}, Logger: zerolog.Nop()}
	cases := map[string]func(*AnalyticsConfig){
		"nil runner":    func(c *AnalyticsConfig) { c.Runner = nil },
		"nil metastore": func(c *AnalyticsConfig) { c.Metastore = nil },
		"nil store":     func(c *AnalyticsConfig) { c.Store = nil },
		"nil resolver":  func(c *AnalyticsConfig) { c.Entitlements = nil },
	}
	for name, mutate := range cases {
		cfg := good
		mutate(&cfg)
		if _, err := NewAnalyticsService(cfg); err == nil {
			t.Errorf("%s: expected validation error", name)
		}
	}
}

// --- concurrency: many simultaneous analytics requests are race-free ----------

func TestAnalytics_ConcurrentRequests(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	id := uuid.NewString()
	rb := uuid.NewString()
	ms := &fakeAnalyticsMetastore{page: metastore.ListPage{
		Applications: []metastore.Application{app(id, "svc", "Service", metastore.TierOne, 600, rb)},
		Total:        1,
	}}
	store := &fakeAnalyticsStore{events: map[string][]RecoveryEvent{
		id: {{EventID: uuid.NewString(), Status: "completed", Succeeded: true, RTAActualSecond: ptr(500), StartedAt: now.Add(-time.Hour)}},
	}}
	resolver := &stubResolver{active: map[string]bool{EntitlementITDR: true}}
	svc, err := NewAnalyticsService(AnalyticsConfig{
		Runner:       concurrentRunner{},
		Metastore:    ms,
		Store:        store,
		Entitlements: resolver,
		Logger:       zerolog.Nop(),
		Now:          func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewAnalyticsService: %v", err)
	}

	const n = 24
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.Analytics(context.Background(), uuid.New(), "Bearer t")
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent Analytics: %v", err)
		}
	}
	// Each request appended exactly one snapshot — the append-only trend grew by n.
	if got := store.appendedCount(); got != n {
		t.Errorf("appended snapshots = %d, want %d", got, n)
	}
}

// --- pure derivation edge cases ----------------------------------------------

func TestDeriveApplicationAnalytics_LatestRTAIsNewest(t *testing.T) {
	a := app(uuid.NewString(), "k", "K", metastore.TierTwo, 1000, uuid.NewString())
	// Newest-first events: the FIRST completed one is the latest actual.
	events := []RecoveryEvent{
		{Status: "running"}, // in-flight (no RTA)
		{Status: "completed", Succeeded: true, RTAActualSecond: ptr(800)}, // latest completed
		{Status: "completed", Succeeded: true, RTAActualSecond: ptr(1500)},
	}
	out := deriveApplicationAnalytics(&a, events)
	if out.LatestRTASeconds == nil || *out.LatestRTASeconds != 800 {
		t.Errorf("latest RTA = %v, want 800 (newest completed)", out.LatestRTASeconds)
	}
	if out.RTABreach {
		t.Errorf("800 <= 1000 target, should not breach")
	}
	if out.ExecutionCount != 3 || out.SuccessCount != 2 {
		t.Errorf("counts = %d/%d, want 3/2", out.ExecutionCount, out.SuccessCount)
	}
}

func TestDerivePortfolioReadiness_Bounds(t *testing.T) {
	if score, _ := derivePortfolioReadiness(nil); score != 0 {
		t.Errorf("nil estate = %d, want 0", score)
	}
	apps := []ApplicationAnalytics{
		{ExecutionCount: 2, SuccessCount: 2, LatestRTASeconds: ptr(10), RTABreach: false},
	}
	if score, _ := derivePortfolioReadiness(apps); score != 100 {
		t.Errorf("perfect estate = %d, want 100", score)
	}
}

func TestDeriveBottlenecks_RankedBySeverityAndBounded(t *testing.T) {
	var apps []ApplicationAnalytics
	// A large breach (severity high) and many small ones to exceed the cap.
	apps = append(apps, ApplicationAnalytics{AppKey: "big", Name: "Big", RTOTargetSeconds: 100, LatestRTASeconds: ptr(1000), RTABreach: true, BreachSeconds: 900})
	for i := 0; i < analyticsTopBottlenecks+5; i++ {
		apps = append(apps, ApplicationAnalytics{AppKey: "small", Name: "Small", RTOTargetSeconds: 1000, LatestRTASeconds: ptr(1010), RTABreach: true, BreachSeconds: 10})
	}
	out := deriveBottlenecks(apps)
	if len(out) > analyticsTopBottlenecks {
		t.Errorf("bottlenecks = %d, want <= %d", len(out), analyticsTopBottlenecks)
	}
	if out[0].AppKey != "big" {
		t.Errorf("worst bottleneck = %q, want the largest breach", out[0].AppKey)
	}
}

// --- handler-level: authz + entitlement mapping ------------------------------

type stubAnalyticsSvc struct {
	view *AnalyticsView
	err  error
}

func (s *stubAnalyticsSvc) Analytics(_ context.Context, _ uuid.UUID, _ string) (*AnalyticsView, error) {
	return s.view, s.err
}

func TestAnalyticsHandler_OK(t *testing.T) {
	h := newAnalyticsHandler(&stubAnalyticsSvc{view: &AnalyticsView{PortfolioReadiness: 77, Applications: []ApplicationAnalytics{}, Bottlenecks: []Bottleneck{}}}, zerolog.Nop())
	router := h.Routes()

	req := httptest.NewRequest(http.MethodGet, "/analytics", nil)
	req.Header.Set("Authorization", "Bearer abc")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // dr:read

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data AnalyticsView `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.PortfolioReadiness != 77 {
		t.Errorf("payload = %+v", resp.Data)
	}
}

func TestAnalyticsHandler_Unauthenticated(t *testing.T) {
	h := newAnalyticsHandler(&stubAnalyticsSvc{view: &AnalyticsView{}}, zerolog.Nop())
	router := h.Routes()

	req := httptest.NewRequest(http.MethodGet, "/analytics", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req) // no user/tenant → RequirePermission denies

	if rec.Code == http.StatusOK {
		t.Fatalf("status = %d, want a non-200 denial", rec.Code)
	}
}

func TestAnalyticsHandler_NotEntitled(t *testing.T) {
	h := newAnalyticsHandler(&stubAnalyticsSvc{err: ErrAnalyticsNotEntitled}, zerolog.Nop())
	router := h.Routes()

	req := httptest.NewRequest(http.MethodGet, "/analytics", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want 402", rec.Code)
	}
}

func TestAnalyticsHandler_EntitlementUnavailable(t *testing.T) {
	h := newAnalyticsHandler(&stubAnalyticsSvc{err: ErrEntitlementUnavailable}, zerolog.Nop())
	router := h.Routes()

	req := httptest.NewRequest(http.MethodGet, "/analytics", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}
