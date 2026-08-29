package recover

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/ransomware"
	"github.com/clario360/platform/internal/dr/repository"
	cyberrecovery "github.com/clario360/platform/internal/recover/cyberrecovery"
)

// noopRunner satisfies cyberrecovery.TenantRunner without touching a database.
// The mount tests below never reach a transaction (the request is denied by the
// permission gate, or short-circuits on the missing tenant) so fn is never run;
// the runner exists only so cyberrecovery.NewService validates.
type noopRunner struct{}

func (noopRunner) RunReadWithTenant(context.Context, uuid.UUID, func(repository.DBTX) error) error {
	return nil
}
func (noopRunner) RunWithTenant(context.Context, uuid.UUID, func(repository.DBTX) error) error {
	return nil
}

// noopScanner satisfies cyberrecovery.IntegrityScanner (never invoked here).
type noopScanner struct{}

func (noopScanner) ScanRecoveryPoint(context.Context, uuid.UUID, uuid.UUID) (cyberrecovery.IntegrityResult, error) {
	return cyberrecovery.IntegrityResult{}, nil
}

// noopRansomware satisfies cyberrecovery.RansomwareReader (never invoked here).
type noopRansomware struct{}

func (noopRansomware) ListSignals(context.Context, repository.DBTX, string, int) ([]ransomware.Signal, error) {
	return nil, nil
}

// newCyberRecoveryRouter builds a real cyberrecovery.Router whose service is
// constructible but whose backing dependencies are never reached by the mount
// tests (the permission gate / missing-tenant guard run before any service call).
func newCyberRecoveryRouter(t *testing.T) *cyberrecovery.Router {
	t.Helper()
	svc, err := cyberrecovery.NewService(cyberrecovery.Config{
		Runner:     noopRunner{},
		Store:      cyberrecovery.NewStore(),
		Scanner:    noopScanner{},
		Ransomware: noopRansomware{},
		Logger:     zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("construct cyberrecovery service: %v", err)
	}
	return cyberrecovery.NewRouter(svc, zerolog.Nop())
}

// TestRouter_CyberRecoveryOverview_Mounted proves the recover product Router
// actually mounts the Cyber Recovery overview at /cyber-recovery/overview when
// the CyberRecovery sub-router is wired. The route was previously unreachable
// (404) because the plane was never attached; this locks the registration so a
// dr:read-bearing caller reaches the handler (not a 404) on the same Auth+Tenant
// group as the it-dr / cloud-dr overview siblings.
func TestRouter_CyberRecoveryOverview_Mounted(t *testing.T) {
	r := newRouter(&fakeProductService{}, zerolog.Nop())
	r.CyberRecovery = newCyberRecoveryRouter(t)
	router := r.Routes()

	// dr:read present but NO tenant context: the route resolves and the handler
	// runs, returning 401 (missing tenant) — crucially NOT 404. A 404 would mean
	// the /cyber-recovery mount is absent, which is the bug under repair.
	req := httptest.NewRequest(http.MethodGet, "/cyber-recovery/overview", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withReadOnlyUserNoTenant(req))

	if rec.Code == http.StatusNotFound {
		t.Fatalf("GET /cyber-recovery/overview returned 404 — the cyber-recovery plane is not mounted; body=%s", rec.Body.String())
	}
}

// TestRouter_CyberRecoveryOverview_RequiresRead proves the mounted overview is
// dr:read-gated, mirroring the it-dr / cloud-dr overview siblings: a caller with
// no permissions is rejected before the handler (so no 404, and not a 200).
func TestRouter_CyberRecoveryOverview_RequiresRead(t *testing.T) {
	r := newRouter(&fakeProductService{}, zerolog.Nop())
	r.CyberRecovery = newCyberRecoveryRouter(t)
	router := r.Routes()

	req := httptest.NewRequest(http.MethodGet, "/cyber-recovery/overview", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New())) // no roles → no dr:read

	if rec.Code == http.StatusNotFound {
		t.Fatalf("route not mounted (404); want a permission denial")
	}
	if rec.Code == http.StatusOK {
		t.Fatalf("status = %d, want a non-200 permission denial for a caller without dr:read", rec.Code)
	}
}

// TestRouter_CyberRecoveryOverview_AbsentWhenUnwired documents the failure mode
// the live 404 came from: with the CyberRecovery plane left nil (as it currently
// is in the running service's wiring), the overview route is not registered at
// all and resolves to 404.
func TestRouter_CyberRecoveryOverview_AbsentWhenUnwired(t *testing.T) {
	router := newRouter(&fakeProductService{}, zerolog.Nop()).Routes() // CyberRecovery == nil

	req := httptest.NewRequest(http.MethodGet, "/cyber-recovery/overview", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // has dr:read

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 when the cyber-recovery plane is unwired", rec.Code)
	}
}

// withReadOnlyUserNoTenant attaches a dr:read-bearing user but deliberately omits
// the tenant id from context, so a reached handler fails the tenant guard (401)
// rather than a routing miss (404) — letting the test distinguish the two.
func withReadOnlyUserNoTenant(req *http.Request) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), Roles: []string{"analyst"}}
	return req.WithContext(auth.WithUser(req.Context(), user))
}
