package vmcapture_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/vmcapture"
)

const routerTenant = "aaaaaaaa-0000-0000-0000-000000000001"

// stubAPI is a hand-written API double recording calls and returning canned
// values, so the router is tested without a service/DB.
type stubAPI struct {
	source  *vmcapture.Source
	sources []vmcapture.Source
	epoch   *vmcapture.Epoch
	epochs  []vmcapture.Epoch
	err     error

	lastRegister vmcapture.RegisterInput
	ranSource    uuid.UUID
}

func (s *stubAPI) RegisterSource(_ context.Context, _ uuid.UUID, in vmcapture.RegisterInput) (*vmcapture.Source, error) {
	s.lastRegister = in
	return s.source, s.err
}
func (s *stubAPI) ListSources(context.Context, uuid.UUID) ([]vmcapture.Source, error) {
	return s.sources, s.err
}
func (s *stubAPI) RunCapture(_ context.Context, _, sourceID uuid.UUID) (*vmcapture.Epoch, error) {
	s.ranSource = sourceID
	return s.epoch, s.err
}
func (s *stubAPI) ListEpochs(context.Context, uuid.UUID, uuid.UUID) ([]vmcapture.Epoch, error) {
	return s.epochs, s.err
}

func mount(api vmcapture.API) http.Handler {
	h := vmcapture.NewHandler(api, zerolog.Nop())
	root := chi.NewRouter()
	root.Use(injectContext)
	root.Mount("/", h.Routes())
	return root
}

func injectContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := auth.WithTenantID(r.Context(), routerTenant)
		ctx = auth.WithUser(ctx, &auth.ContextUser{
			ID:       "cccccccc-0000-0000-0000-000000000003",
			TenantID: routerTenant,
			Roles:    []string{"super_admin"},
		})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func doReq(t *testing.T, h http.Handler, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	var req *http.Request
	if body != "" {
		req = httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	} else {
		req = httptest.NewRequest(method, target, nil)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRouter_RegisterSource(t *testing.T) {
	t.Parallel()
	api := &stubAPI{source: &vmcapture.Source{ID: "src-1", Name: "vm-a", SourceKind: "vm_disk"}}
	h := mount(api)

	body := `{"stream_id":"11111111-1111-1111-1111-111111111111","name":"vm-a","source_kind":"vm_disk","binding_kind":"file","config":{"path":"/img"}}`
	rec := doReq(t, h, http.MethodPost, "/workload-captures", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if api.lastRegister.Name != "vm-a" || api.lastRegister.SourceKind != "vm_disk" {
		t.Fatalf("register input not decoded: %+v", api.lastRegister)
	}
	var resp struct {
		Data vmcapture.Source `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Data.ID != "src-1" {
		t.Fatalf("response source id = %q", resp.Data.ID)
	}
}

func TestRouter_ListSources_EmptyIsArray(t *testing.T) {
	t.Parallel()
	api := &stubAPI{}
	h := mount(api)
	rec := doReq(t, h, http.MethodGet, "/workload-captures", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp struct {
		Data []vmcapture.Source `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Data == nil {
		t.Fatal("expected [] not null for empty source list")
	}
}

func TestRouter_RunCapture(t *testing.T) {
	t.Parallel()
	sourceID := uuid.New()
	api := &stubAPI{epoch: &vmcapture.Epoch{Epoch: 1, EpochKind: "base", FrameCount: 5, ChangedUnits: 5}}
	h := mount(api)
	rec := doReq(t, h, http.MethodPost, "/workload-captures/"+sourceID.String()+"/run", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if api.ranSource != sourceID {
		t.Fatalf("ran source = %s, want %s", api.ranSource, sourceID)
	}
	var resp struct {
		Data vmcapture.Epoch `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Data.EpochKind != "base" || resp.Data.ChangedUnits != 5 {
		t.Fatalf("unexpected epoch body: %+v", resp.Data)
	}
}

func TestRouter_ListEpochs(t *testing.T) {
	t.Parallel()
	sourceID := uuid.New()
	api := &stubAPI{epochs: []vmcapture.Epoch{{Epoch: 1, EpochKind: "base"}, {Epoch: 2, EpochKind: "incremental"}}}
	h := mount(api)
	rec := doReq(t, h, http.MethodGet, "/workload-captures/"+sourceID.String()+"/epochs", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp struct {
		Data []vmcapture.Epoch `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Data) != 2 {
		t.Fatalf("epochs = %d, want 2", len(resp.Data))
	}
}

func TestRouter_RunCapture_NotFoundMapsTo404(t *testing.T) {
	t.Parallel()
	api := &stubAPI{err: vmcapture.ErrNotFound}
	h := mount(api)
	rec := doReq(t, h, http.MethodPost, "/workload-captures/"+uuid.New().String()+"/run", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestRouter_RegisterSource_BadUUIDParam(t *testing.T) {
	t.Parallel()
	api := &stubAPI{}
	h := mount(api)
	rec := doReq(t, h, http.MethodPost, "/workload-captures/not-a-uuid/run", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
