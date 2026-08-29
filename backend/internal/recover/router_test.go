package recover

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// fakeProductService implements productService so the router's HTTP wiring,
// permission gating, and error mapping are tested without a database or a live
// licensing engine.
type fakeProductService struct {
	view    *ProductView
	viewErr error

	act       *Activation
	actErr    error
	lastSub   string
	lastFlag  bool
	lastAuthz string
}

func (f *fakeProductService) GetProducts(_ context.Context, _ uuid.UUID, authorization string) (*ProductView, error) {
	f.lastAuthz = authorization
	return f.view, f.viewErr
}

func (f *fakeProductService) SetActivation(_ context.Context, _ uuid.UUID, sub string, activated bool) (*Activation, error) {
	f.lastSub = sub
	f.lastFlag = activated
	return f.act, f.actErr
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func TestRouter_GetProducts_Shape(t *testing.T) {
	svc := &fakeProductService{view: &ProductView{
		Product: Product,
		Label:   ProductLabel,
		SubSolutions: []SubSolution{{
			ID:             SubSolutionITDR,
			Label:          "IT Disaster Recovery",
			EntitlementKey: EntitlementITDR,
			Entitlement:    &EntitlementState{Key: EntitlementITDR, Active: true},
			Capabilities:   []Capability{{ID: "runbookstudio", Label: "Runbook Studio", Service: "github.com/clario360/platform/internal/dr/runbookstudio"}},
		}},
	}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/products", nil)
	req.Header.Set("Authorization", "Bearer abc")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // analyst has dr:read

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastAuthz != "Bearer abc" {
		t.Errorf("authorization forwarded = %q, want %q", svc.lastAuthz, "Bearer abc")
	}

	var resp struct {
		Data ProductView `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Data.Product != Product {
		t.Errorf("product = %q, want %q", resp.Data.Product, Product)
	}
	if len(resp.Data.SubSolutions) != 1 || resp.Data.SubSolutions[0].Entitlement == nil {
		t.Fatalf("unexpected sub-solutions payload: %+v", resp.Data.SubSolutions)
	}
}

func TestRouter_GetProducts_Unauthenticated(t *testing.T) {
	svc := &fakeProductService{view: &ProductView{}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	// No user/tenant context — RequirePermission denies before the handler.
	req := httptest.NewRequest(http.MethodGet, "/products", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatalf("status = %d, want a non-200 denial", rec.Code)
	}
}

func TestRouter_GetProducts_EntitlementUnavailable(t *testing.T) {
	svc := &fakeProductService{viewErr: ErrEntitlementUnavailable}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/products", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

func TestRouter_Activate_RequiresAdmin(t *testing.T) {
	svc := &fakeProductService{act: &Activation{SubSolution: SubSolutionITDR, Activated: true}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	body := strings.NewReader(`{"activated":true}`)
	req := httptest.NewRequest(http.MethodPost, "/sub-solutions/it-dr/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	// analyst has dr:read but NOT dr:admin → forbidden.
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code == http.StatusOK {
		t.Fatalf("analyst (no dr:admin) reached activate handler: status %d", rec.Code)
	}
	if svc.lastSub != "" {
		t.Error("service should not have been called for an unauthorized request")
	}
}

func TestRouter_Activate_AdminAllowed(t *testing.T) {
	svc := &fakeProductService{act: &Activation{SubSolution: SubSolutionCloudDR, Activated: true}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	body := strings.NewReader(`{"activated":true}`)
	req := httptest.NewRequest(http.MethodPost, "/sub-solutions/cloud-dr/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin")) // has dr:admin

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastSub != SubSolutionCloudDR || !svc.lastFlag {
		t.Errorf("service called with sub=%q flag=%v", svc.lastSub, svc.lastFlag)
	}
}

func TestRouter_Activate_UnknownSubSolution(t *testing.T) {
	svc := &fakeProductService{actErr: ErrUnknownSubSolution}
	router := newRouter(svc, zerolog.Nop()).Routes()

	body := strings.NewReader(`{"activated":true}`)
	req := httptest.NewRequest(http.MethodPost, "/sub-solutions/bogus/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
