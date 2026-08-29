package recover

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// fakeRunner runs fn with a nil DBTX (the fake store ignores it). It records
// whether a write transaction was used, proving SetActivation takes the
// read-write path.
type fakeRunner struct {
	wrote bool
}

func (f *fakeRunner) RunReadWithTenant(ctx context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(nil)
}

func (f *fakeRunner) RunWithTenant(ctx context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	f.wrote = true
	return fn(nil)
}

// memStore is an in-memory ActivationStore for service tests (mocks live only
// in test files). It is not a source of truth for product code.
type memStore struct {
	rows    map[string]Activation
	listErr error
}

func newMemStore() *memStore { return &memStore{rows: map[string]Activation{}} }

func (m *memStore) ListActivations(_ context.Context, _ repository.DBTX, _ uuid.UUID) (map[string]Activation, error) {
	if m.listErr != nil {
		return nil, m.listErr
	}
	out := make(map[string]Activation, len(m.rows))
	for k, v := range m.rows {
		out[k] = v
	}
	return out, nil
}

func (m *memStore) SetActivation(_ context.Context, _ repository.DBTX, _ uuid.UUID, sub string, activated bool, now time.Time) error {
	m.rows[sub] = Activation{SubSolution: sub, Activated: activated, UpdatedAt: now}
	return nil
}

// stubResolver answers from a per-key active map; err simulates an outage.
type stubResolver struct {
	active map[string]bool
	reason map[string]string
	err    error
}

func (s *stubResolver) Resolve(_ context.Context, _, _, key string) (bool, string, error) {
	if s.err != nil {
		return false, "", s.err
	}
	return s.active[key], s.reason[key], nil
}

func newService(t *testing.T, store ActivationStore, resolver EntitlementResolver) (*Service, *fakeRunner) {
	t.Helper()
	runner := &fakeRunner{}
	svc, err := NewService(Config{
		Runner:       runner,
		Store:        store,
		Entitlements: resolver,
		Logger:       zerolog.Nop(),
		Now:          func() time.Time { return time.Unix(1700000000, 0).UTC() },
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc, runner
}

func TestGetProducts_PerSubSolutionEntitlement(t *testing.T) {
	store := newMemStore()
	// IT DR licensed and activated; Cloud DR licensed but not activated; Cyber
	// Recovery not licensed.
	store.rows[SubSolutionITDR] = Activation{SubSolution: SubSolutionITDR, Activated: true}
	resolver := &stubResolver{
		active: map[string]bool{
			EntitlementITDR:    true,
			EntitlementCloudDR: true,
		},
		reason: map[string]string{
			EntitlementCyberRecovery: "not included in plan",
		},
	}
	svc, _ := newService(t, store, resolver)

	view, err := svc.GetProducts(context.Background(), uuid.New(), "Bearer t")
	if err != nil {
		t.Fatalf("GetProducts: %v", err)
	}
	if view.Product != Product || view.Label != ProductLabel {
		t.Errorf("product identity = %q/%q", view.Product, view.Label)
	}
	if len(view.SubSolutions) != 3 {
		t.Fatalf("sub-solutions = %d, want 3", len(view.SubSolutions))
	}

	byID := map[string]SubSolution{}
	for _, ss := range view.SubSolutions {
		if ss.Entitlement == nil {
			t.Fatalf("%s missing entitlement state", ss.ID)
		}
		byID[ss.ID] = ss
	}

	if it := byID[SubSolutionITDR]; !it.Entitlement.Active || !it.Entitlement.Activated {
		t.Errorf("it-dr = %+v, want active+activated", it.Entitlement)
	}
	if cl := byID[SubSolutionCloudDR]; !cl.Entitlement.Active || cl.Entitlement.Activated {
		t.Errorf("cloud-dr = %+v, want active and NOT activated", cl.Entitlement)
	}
	if cy := byID[SubSolutionCyberRecovery]; cy.Entitlement.Active {
		t.Errorf("cyber-recovery resolved active, want not licensed")
	} else if cy.Entitlement.Reason != "not included in plan" {
		t.Errorf("cyber-recovery reason = %q", cy.Entitlement.Reason)
	}
}

// TestGetProducts_NeverAllEnabled proves the product does NOT hardcode "all
// enabled": with the resolver denying everything, every sub-solution is
// inactive.
func TestGetProducts_NeverAllEnabled(t *testing.T) {
	resolver := &stubResolver{active: map[string]bool{}} // nothing licensed
	svc, _ := newService(t, newMemStore(), resolver)

	view, err := svc.GetProducts(context.Background(), uuid.New(), "Bearer t")
	if err != nil {
		t.Fatalf("GetProducts: %v", err)
	}
	for _, ss := range view.SubSolutions {
		if ss.Entitlement.Active {
			t.Errorf("%s active with no license; product must not hardcode all-enabled", ss.ID)
		}
	}
}

func TestGetProducts_EntitlementOutageFailsClosed(t *testing.T) {
	resolver := &stubResolver{err: errors.Join(ErrEntitlementUnavailable, errors.New("outage"))}
	svc, _ := newService(t, newMemStore(), resolver)

	_, err := svc.GetProducts(context.Background(), uuid.New(), "Bearer t")
	if !errors.Is(err, ErrEntitlementUnavailable) {
		t.Fatalf("err = %v, want ErrEntitlementUnavailable", err)
	}
}

func TestGetProducts_StoreError(t *testing.T) {
	store := newMemStore()
	store.listErr = errors.New("db down")
	svc, _ := newService(t, store, &stubResolver{active: map[string]bool{}})

	if _, err := svc.GetProducts(context.Background(), uuid.New(), "Bearer t"); err == nil {
		t.Fatal("expected store error to propagate")
	}
}

func TestGetProducts_RequiresTenant(t *testing.T) {
	svc, _ := newService(t, newMemStore(), &stubResolver{active: map[string]bool{}})
	if _, err := svc.GetProducts(context.Background(), uuid.Nil, "Bearer t"); err == nil {
		t.Fatal("expected error for nil tenant")
	}
}

func TestSetActivation_PersistsAndValidates(t *testing.T) {
	store := newMemStore()
	svc, runner := newService(t, store, &stubResolver{active: map[string]bool{}})

	act, err := svc.SetActivation(context.Background(), uuid.New(), SubSolutionCloudDR, true)
	if err != nil {
		t.Fatalf("SetActivation: %v", err)
	}
	if !runner.wrote {
		t.Error("SetActivation must use the read-write transaction path")
	}
	if !act.Activated || act.SubSolution != SubSolutionCloudDR {
		t.Errorf("activation = %+v", act)
	}
	if got := store.rows[SubSolutionCloudDR]; !got.Activated {
		t.Error("activation not persisted to store")
	}
}

func TestSetActivation_UnknownSubSolution(t *testing.T) {
	svc, _ := newService(t, newMemStore(), &stubResolver{active: map[string]bool{}})
	if _, err := svc.SetActivation(context.Background(), uuid.New(), "bogus", true); !errors.Is(err, ErrUnknownSubSolution) {
		t.Fatalf("err = %v, want ErrUnknownSubSolution", err)
	}
}

func TestNewService_Validation(t *testing.T) {
	good := Config{Runner: &fakeRunner{}, Store: newMemStore(), Entitlements: &stubResolver{}, Logger: zerolog.Nop()}
	cases := map[string]func(*Config){
		"nil runner":   func(c *Config) { c.Runner = nil },
		"nil store":    func(c *Config) { c.Store = nil },
		"nil resolver": func(c *Config) { c.Entitlements = nil },
	}
	for name, mutate := range cases {
		cfg := good
		mutate(&cfg)
		if _, err := NewService(cfg); err == nil {
			t.Errorf("%s: expected validation error", name)
		}
	}
}
