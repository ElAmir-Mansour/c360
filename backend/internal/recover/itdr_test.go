package recover

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// fakeITDRStore is an in-memory ITDROverviewStore for service tests. Mocks live
// only in test files; it is never a source of truth for product code.
type fakeITDRStore struct {
	inventory RunbookInventory
	last      *RehearsalRun
	upcoming  *UpcomingRehearsal
	approvals OpenApprovals
	stats     RehearsalStats

	err error

	gotPage, gotPerPage int
	gotApprovalLimit    int
}

func (f *fakeITDRStore) RunbookInventory(_ context.Context, _ repository.DBTX, page, perPage int) (RunbookInventory, error) {
	f.gotPage, f.gotPerPage = page, perPage
	return f.inventory, f.err
}
func (f *fakeITDRStore) LastRehearsal(_ context.Context, _ repository.DBTX) (*RehearsalRun, error) {
	return f.last, f.err
}
func (f *fakeITDRStore) UpcomingRehearsal(_ context.Context, _ repository.DBTX, _ time.Time) (*UpcomingRehearsal, error) {
	return f.upcoming, f.err
}
func (f *fakeITDRStore) OpenApprovals(_ context.Context, _ repository.DBTX, limit int) (OpenApprovals, error) {
	f.gotApprovalLimit = limit
	return f.approvals, f.err
}
func (f *fakeITDRStore) RehearsalStats(_ context.Context, _ repository.DBTX, _ time.Time) (RehearsalStats, error) {
	return f.stats, f.err
}

func newITDRService(t *testing.T, store ITDROverviewStore, resolver EntitlementResolver, now time.Time) *ITDRService {
	t.Helper()
	svc, err := NewITDRService(ITDRConfig{
		Runner:       &fakeRunner{},
		Store:        store,
		Entitlements: resolver,
		Logger:       zerolog.Nop(),
		Now:          func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewITDRService: %v", err)
	}
	return svc
}

func TestITDR_Overview_HappyPath(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	store := &fakeITDRStore{
		inventory: RunbookInventory{
			Total:    4,
			ByStatus: map[string]int{"published": 3, "draft": 1},
			Items:    []RunbookSummary{{ID: uuid.NewString(), Name: "App failover", Status: "published", TaskCount: 5}},
		},
		last:      &RehearsalRun{RunID: uuid.NewString(), Status: "completed", StartedAt: now.Add(-24 * time.Hour)},
		upcoming:  &UpcomingRehearsal{ScheduleID: uuid.NewString(), Name: "Quarterly", NextRun: now.Add(72 * time.Hour)},
		approvals: OpenApprovals{Total: 0, Items: []ApprovalItem{}},
		stats:     RehearsalStats{Total: 4, Completed: 4},
	}
	resolver := &stubResolver{active: map[string]bool{EntitlementITDR: true}}
	svc := newITDRService(t, store, resolver, now)

	view, err := svc.Overview(context.Background(), uuid.New(), "Bearer t", 1, 20)
	if err != nil {
		t.Fatalf("Overview: %v", err)
	}
	if view.SubSolution != SubSolutionITDR {
		t.Errorf("sub_solution = %q", view.SubSolution)
	}
	if view.Inventory.Total != 4 || view.Inventory.Page != 1 || view.Inventory.PerPage != 20 {
		t.Errorf("inventory = %+v", view.Inventory)
	}
	if store.gotPage != 1 || store.gotPerPage != 20 {
		t.Errorf("pagination not forwarded: page=%d perPage=%d", store.gotPage, store.gotPerPage)
	}
	if store.gotApprovalLimit != defaultApprovalListLimit {
		t.Errorf("approval limit = %d, want %d", store.gotApprovalLimit, defaultApprovalListLimit)
	}
	if view.LastRehearsal == nil || view.UpcomingRehearsal == nil {
		t.Fatal("expected last and upcoming rehearsal")
	}
	// All three readiness components near-max → high score.
	if view.Readiness.Score < 80 {
		t.Errorf("readiness score = %d, want >= 80 for a fresh, published, unblocked estate", view.Readiness.Score)
	}
	if len(view.Readiness.Components) != 3 {
		t.Errorf("expected 3 readiness components, got %d", len(view.Readiness.Components))
	}
	if !view.GeneratedAt.Equal(now) {
		t.Errorf("generated_at = %v, want %v", view.GeneratedAt, now)
	}
}

func TestITDR_Overview_NotEntitled(t *testing.T) {
	resolver := &stubResolver{active: map[string]bool{}} // it_dr NOT licensed
	svc := newITDRService(t, &fakeITDRStore{}, resolver, time.Now())

	_, err := svc.Overview(context.Background(), uuid.New(), "Bearer t", 1, 20)
	if !errors.Is(err, ErrITDRNotEntitled) {
		t.Fatalf("err = %v, want ErrITDRNotEntitled", err)
	}
}

func TestITDR_Overview_EntitlementUnavailableFailsClosed(t *testing.T) {
	resolver := &stubResolver{err: errors.Join(ErrEntitlementUnavailable, errors.New("outage"))}
	svc := newITDRService(t, &fakeITDRStore{}, resolver, time.Now())

	_, err := svc.Overview(context.Background(), uuid.New(), "Bearer t", 1, 20)
	if !errors.Is(err, ErrEntitlementUnavailable) {
		t.Fatalf("err = %v, want ErrEntitlementUnavailable", err)
	}
}

func TestITDR_Overview_StoreErrorPropagates(t *testing.T) {
	store := &fakeITDRStore{err: errors.New("db down")}
	resolver := &stubResolver{active: map[string]bool{EntitlementITDR: true}}
	svc := newITDRService(t, store, resolver, time.Now())

	if _, err := svc.Overview(context.Background(), uuid.New(), "Bearer t", 1, 20); err == nil {
		t.Fatal("expected store error to propagate")
	}
}

func TestITDR_Overview_RequiresTenant(t *testing.T) {
	resolver := &stubResolver{active: map[string]bool{EntitlementITDR: true}}
	svc := newITDRService(t, &fakeITDRStore{}, resolver, time.Now())
	if _, err := svc.Overview(context.Background(), uuid.Nil, "Bearer t", 1, 20); err == nil {
		t.Fatal("expected error for nil tenant")
	}
}

func TestNewITDRService_Validation(t *testing.T) {
	good := ITDRConfig{Runner: &fakeRunner{}, Store: &fakeITDRStore{}, Entitlements: &stubResolver{}, Logger: zerolog.Nop()}
	cases := map[string]func(*ITDRConfig){
		"nil runner":   func(c *ITDRConfig) { c.Runner = nil },
		"nil store":    func(c *ITDRConfig) { c.Store = nil },
		"nil resolver": func(c *ITDRConfig) { c.Entitlements = nil },
	}
	for name, mutate := range cases {
		cfg := good
		mutate(&cfg)
		if _, err := NewITDRService(cfg); err == nil {
			t.Errorf("%s: expected validation error", name)
		}
	}
}

// --- Readiness computation edge cases (pure function) ----------------------

func TestComputeReadiness_EmptyEstate(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	r := computeReadiness(RunbookInventory{Total: 0, ByStatus: map[string]int{}}, nil, RehearsalStats{}, OpenApprovals{}, now)
	if r.Score != 0 {
		t.Errorf("empty estate score = %d, want 0", r.Score)
	}
}

func TestComputeReadiness_AllPublishedNoRehearsalNoBacklog(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	inv := RunbookInventory{Total: 2, ByStatus: map[string]int{"published": 2}}
	// published=1.0*0.40 + rehearsal=0*0.40 + approvals=1.0*0.20 → 60.
	r := computeReadiness(inv, nil, RehearsalStats{}, OpenApprovals{Total: 0}, now)
	if r.Score != 60 {
		t.Errorf("score = %d, want 60 (published + clean approvals, no rehearsal)", r.Score)
	}
}

func TestComputeReadiness_StaleRehearsalContributesNothing(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	inv := RunbookInventory{Total: 1, ByStatus: map[string]int{"published": 1}}
	old := &RehearsalRun{StartedAt: now.Add(-200 * 24 * time.Hour)} // older than the 90d window
	r := computeReadiness(inv, old, RehearsalStats{Total: 0}, OpenApprovals{Total: 0}, now)
	// recency 0 (stale), success 0 (no rehearsals in window) → rehearsal component 0.
	if r.Score != 60 {
		t.Errorf("score = %d, want 60 (stale rehearsal scores zero)", r.Score)
	}
}

func TestComputeReadiness_ApprovalBacklogSaturates(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	inv := RunbookInventory{Total: 1, ByStatus: map[string]int{"published": 1}}
	// approvals at/over the floor → approval component 0; published only → 40.
	r := computeReadiness(inv, nil, RehearsalStats{}, OpenApprovals{Total: approvalBacklogFloor + 3}, now)
	if r.Score != 40 {
		t.Errorf("score = %d, want 40 (saturated approval backlog scores zero on that component)", r.Score)
	}
	for _, c := range r.Components {
		if c.Key == "approval_backlog" && c.Value != 0 {
			t.Errorf("approval component value = %v, want 0 when saturated", c.Value)
		}
	}
}

func TestComputeReadiness_BoundedZeroToHundred(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	inv := RunbookInventory{Total: 10, ByStatus: map[string]int{"published": 10}}
	fresh := &RehearsalRun{StartedAt: now} // recency 1
	r := computeReadiness(inv, fresh, RehearsalStats{Total: 5, Completed: 5}, OpenApprovals{Total: 0}, now)
	if r.Score != 100 {
		t.Errorf("score = %d, want 100 for a perfect estate", r.Score)
	}
}

// --- Handler-level: authz + entitlement mapping ----------------------------

// stubITDRSvc lets the handler tests exercise route gating and error mapping
// without the service/store.
type stubITDRSvc struct {
	view *ITDROverview
	err  error
}

func (s *stubITDRSvc) Overview(_ context.Context, _ uuid.UUID, _ string, _, _ int) (*ITDROverview, error) {
	return s.view, s.err
}

func TestITDRHandler_Overview_OK(t *testing.T) {
	h := newITDRHandler(&stubITDRSvc{view: &ITDROverview{SubSolution: SubSolutionITDR, Readiness: ReadinessScore{Score: 72}}}, zerolog.Nop())
	router := h.Routes()

	req := httptest.NewRequest(http.MethodGet, "/it-dr/overview", nil)
	req.Header.Set("Authorization", "Bearer abc")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // dr:read

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data ITDROverview `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.SubSolution != SubSolutionITDR || resp.Data.Readiness.Score != 72 {
		t.Errorf("payload = %+v", resp.Data)
	}
}

func TestITDRHandler_Overview_Unauthenticated(t *testing.T) {
	h := newITDRHandler(&stubITDRSvc{view: &ITDROverview{}}, zerolog.Nop())
	router := h.Routes()

	req := httptest.NewRequest(http.MethodGet, "/it-dr/overview", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req) // no user/tenant → RequirePermission denies

	if rec.Code == http.StatusOK {
		t.Fatalf("status = %d, want a non-200 denial", rec.Code)
	}
}

func TestITDRHandler_Overview_NotEntitled(t *testing.T) {
	h := newITDRHandler(&stubITDRSvc{err: ErrITDRNotEntitled}, zerolog.Nop())
	router := h.Routes()

	req := httptest.NewRequest(http.MethodGet, "/it-dr/overview", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want 402", rec.Code)
	}
}

func TestITDRHandler_Overview_EntitlementUnavailable(t *testing.T) {
	h := newITDRHandler(&stubITDRSvc{err: ErrEntitlementUnavailable}, zerolog.Nop())
	router := h.Routes()

	req := httptest.NewRequest(http.MethodGet, "/it-dr/overview", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}
