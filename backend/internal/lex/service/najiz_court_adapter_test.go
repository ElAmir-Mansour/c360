package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// fakeEndpointLister is an in-memory najizEndpointLister for adapter tests.
type fakeEndpointLister struct {
	rows []model.IntegrationEndpoint
	err  error
}

func (f *fakeEndpointLister) List(_ context.Context, tenantID uuid.UUID, kind, status string) ([]model.IntegrationEndpoint, error) {
	if f.err != nil {
		return nil, f.err
	}
	out := make([]model.IntegrationEndpoint, 0, len(f.rows))
	for _, r := range f.rows {
		if r.TenantID != tenantID {
			continue
		}
		if kind != "" && string(r.Kind) != kind {
			continue
		}
		if status != "" && string(r.Status) != status {
			continue
		}
		out = append(out, r)
	}
	return out, nil
}

func activeNajizEndpoint(tenantID uuid.UUID, config map[string]any) model.IntegrationEndpoint {
	return model.IntegrationEndpoint{
		ID:       uuid.New(),
		TenantID: tenantID,
		Kind:     model.IntegrationKindNajiz,
		Code:     "najiz-primary",
		Name:     "Najiz",
		Status:   model.IntegrationStatusActive,
		Config:   config,
	}
}

// --- not configured ----------------------------------------------------------

func TestNajiz_NotConfigured_NoEndpoint(t *testing.T) {
	tenant := uuid.New()
	a := newNajizAdapterForTest(&fakeEndpointLister{}, nil, nil)

	_, err := a.SyncCase(context.Background(), tenant, NajizCaseSyncRequest{CaseID: uuid.New()})
	if err != ErrNajizNotConfigured {
		t.Fatalf("SyncCase: want ErrNajizNotConfigured, got %v", err)
	}
	_, err = a.AddRepresentative(context.Background(), tenant, NajizRepresentativeRequest{CompanyRepresentative: "x", DefendantCaseID: uuid.New()})
	if err != ErrNajizNotConfigured {
		t.Fatalf("AddRepresentative: want ErrNajizNotConfigured, got %v", err)
	}

	h := a.Health(context.Background(), tenant)
	if h.Configured || h.Verdict != "not_configured" {
		t.Fatalf("Health: want not_configured/unconfigured, got %+v", h)
	}
}

func TestNajiz_NilLister_NotConfigured(t *testing.T) {
	a := newNajizAdapterForTest(nil, nil, nil)
	_, err := a.SyncCase(context.Background(), uuid.New(), NajizCaseSyncRequest{})
	if err != ErrNajizNotConfigured {
		t.Fatalf("want ErrNajizNotConfigured, got %v", err)
	}
}

func TestNajiz_ActiveNoBaseURL_PlannedHealth(t *testing.T) {
	tenant := uuid.New()
	lister := &fakeEndpointLister{rows: []model.IntegrationEndpoint{
		activeNajizEndpoint(tenant, map[string]any{}),
	}}
	a := newNajizAdapterForTest(lister, nil, nil)

	h := a.Health(context.Background(), tenant)
	if h.Configured || h.Verdict != "planned" {
		t.Fatalf("want planned/unconfigured, got %+v", h)
	}
	if !strings.Contains(h.Detail, "MoJ Takamul") {
		t.Fatalf("detail should mention onboarding, got %q", h.Detail)
	}

	// SyncCase with no base_url and no sandbox falls back to not-configured.
	if _, err := a.SyncCase(context.Background(), tenant, NajizCaseSyncRequest{}); err != ErrNajizNotConfigured {
		t.Fatalf("SyncCase want ErrNajizNotConfigured, got %v", err)
	}
}

// --- write gate ---------------------------------------------------------------

func TestNajiz_WriteGated_ReadOnlyEndpoint(t *testing.T) {
	tenant := uuid.New()
	lister := &fakeEndpointLister{rows: []model.IntegrationEndpoint{
		activeNajizEndpoint(tenant, map[string]any{"base_url": "https://najiz.example"}),
	}}
	a := newNajizAdapterForTest(lister, nil, nil)

	_, err := a.AddRepresentative(context.Background(), tenant, NajizRepresentativeRequest{
		CompanyRepresentative: "Rep",
		DefendantCaseID:       uuid.New(),
	})
	if err != ErrNajizWritesDisabled {
		t.Fatalf("want ErrNajizWritesDisabled, got %v", err)
	}

	h := a.Health(context.Background(), tenant)
	if !h.Configured || h.WritesAllowed || h.Verdict != "read_only" {
		t.Fatalf("want configured read_only writes-off, got %+v", h)
	}
}

// --- live read sync -----------------------------------------------------------

func TestNajiz_SyncCase_LiveHappyPath(t *testing.T) {
	tenant := uuid.New()
	var gotAuth, gotTenant, gotRef string
	var gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotTenant = r.Header.Get("X-Clario360-Tenant-ID")
		gotRef = r.URL.Query().Get("reference")
		gotMethod = r.Method
		_ = json.NewEncoder(w).Encode(map[string]any{
			"reference":      "MOJ-123",
			"court_name":     "Riyadh Commercial Court",
			"plaintiff_name": "Acme",
			"status":         "scheduled",
			"hearings": []map[string]any{
				{"reference": "H1", "court": "Riyadh", "scheduled_at": "2026-08-01T09:00:00Z", "status": "scheduled"},
			},
			"representatives": []map[string]any{
				{"name": "Lawyer A", "national_id": "1234567890", "role": "agent"},
			},
		})
	}))
	defer srv.Close()

	lister := &fakeEndpointLister{rows: []model.IntegrationEndpoint{
		activeNajizEndpoint(tenant, map[string]any{"base_url": srv.URL, "api_key": "secret-key", "org_id": "ORG-1"}),
	}}
	a := newNajizAdapterForTest(lister, srv.Client(), nil)

	res, err := a.SyncCase(context.Background(), tenant, NajizCaseSyncRequest{CaseID: uuid.New(), NajizReference: "MOJ-123"})
	if err != nil {
		t.Fatalf("SyncCase: %v", err)
	}
	if gotMethod != http.MethodGet {
		t.Fatalf("read must be GET, got %s", gotMethod)
	}
	if gotAuth != "Bearer secret-key" {
		t.Fatalf("auth header not set: %q", gotAuth)
	}
	if gotTenant != tenant.String() {
		t.Fatalf("tenant header mismatch: %q", gotTenant)
	}
	if gotRef != "MOJ-123" {
		t.Fatalf("reference query not propagated: %q", gotRef)
	}
	if res.Sandbox {
		t.Fatalf("live result must not be flagged sandbox")
	}
	if len(res.Hearings) != 1 || res.Hearings[0].ScheduledAt.IsZero() {
		t.Fatalf("hearings not normalized: %+v", res.Hearings)
	}
	if len(res.Representatives) != 1 || res.Representatives[0].Name != "Lawyer A" {
		t.Fatalf("representatives not normalized: %+v", res.Representatives)
	}
}

// --- write happy path + idempotency ------------------------------------------

func TestNajiz_AddRepresentative_WritesEnabled_Idempotent(t *testing.T) {
	tenant := uuid.New()
	defendant := uuid.New()
	var firstKey, secondKey string
	calls := int32(0)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		key := r.Header.Get("Idempotency-Key")
		if n == 1 {
			firstKey = key
		} else {
			secondKey = key
		}
		if r.Method != http.MethodPost {
			t.Errorf("write must be POST, got %s", r.Method)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "synced", "reference": "REP-9", "detail": "ok"})
	}))
	defer srv.Close()

	lister := &fakeEndpointLister{rows: []model.IntegrationEndpoint{
		activeNajizEndpoint(tenant, map[string]any{"base_url": srv.URL, "allow_writes": true}),
	}}
	a := newNajizAdapterForTest(lister, srv.Client(), nil)

	req := NajizRepresentativeRequest{
		CaseID:                uuid.New(),
		DefendantCaseID:       defendant,
		CompanyRepresentative: "Rep One",
		NationalID:            "1010101010",
	}
	res, err := a.AddRepresentative(context.Background(), tenant, req)
	if err != nil {
		t.Fatalf("AddRepresentative: %v", err)
	}
	if res.Status != model.NajizSyncStatusSynced || res.Reference != "REP-9" {
		t.Fatalf("unexpected result: %+v", res)
	}
	if res.Metadata["najiz_idempotency_key"] == nil {
		t.Fatalf("idempotency key not recorded in metadata")
	}

	// Retry the SAME logical write -> SAME idempotency key (dedup-safe).
	if _, err := a.AddRepresentative(context.Background(), tenant, req); err != nil {
		t.Fatalf("retry AddRepresentative: %v", err)
	}
	if firstKey == "" || firstKey != secondKey {
		t.Fatalf("idempotency key not stable across retries: %q vs %q", firstKey, secondKey)
	}
}

func TestNajiz_AddRepresentative_RequiresRepresentative(t *testing.T) {
	tenant := uuid.New()
	lister := &fakeEndpointLister{rows: []model.IntegrationEndpoint{
		activeNajizEndpoint(tenant, map[string]any{"base_url": "https://x", "allow_writes": true}),
	}}
	a := newNajizAdapterForTest(lister, nil, nil)
	_, err := a.AddRepresentative(context.Background(), tenant, NajizRepresentativeRequest{DefendantCaseID: uuid.New()})
	if err == nil || !strings.Contains(err.Error(), "company_representative") {
		t.Fatalf("want validation error, got %v", err)
	}
}

// --- retry / backoff ----------------------------------------------------------

func TestNajiz_Retry_TransientThenSuccess(t *testing.T) {
	tenant := uuid.New()
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) < 3 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"reference": "MOJ-OK"})
	}))
	defer srv.Close()

	lister := &fakeEndpointLister{rows: []model.IntegrationEndpoint{
		activeNajizEndpoint(tenant, map[string]any{"base_url": srv.URL}),
	}}
	a := newNajizAdapterForTest(lister, srv.Client(), nil)

	res, err := a.SyncCase(context.Background(), tenant, NajizCaseSyncRequest{})
	if err != nil {
		t.Fatalf("expected success after retries, got %v", err)
	}
	if res.Reference != "MOJ-OK" {
		t.Fatalf("unexpected reference %q", res.Reference)
	}
	if got := atomic.LoadInt32(&calls); got != 3 {
		t.Fatalf("expected 3 attempts (2 retries), got %d", got)
	}
}

func TestNajiz_Retry_ExhaustedTransient(t *testing.T) {
	tenant := uuid.New()
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	lister := &fakeEndpointLister{rows: []model.IntegrationEndpoint{
		activeNajizEndpoint(tenant, map[string]any{"base_url": srv.URL}),
	}}
	a := newNajizAdapterForTest(lister, srv.Client(), nil)

	_, err := a.SyncCase(context.Background(), tenant, NajizCaseSyncRequest{})
	if err == nil {
		t.Fatalf("expected failure after exhausting retries")
	}
	// Error must NOT leak the raw upstream status text verbatim beyond a stable
	// mapped message.
	if strings.Contains(err.Error(), "<html") {
		t.Fatalf("error leaked provider body: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != najizMaxRetries+1 {
		t.Fatalf("expected %d attempts, got %d", najizMaxRetries+1, got)
	}
}

func TestNajiz_NonTransient4xx_NoRetry_FailClosed(t *testing.T) {
	tenant := uuid.New()
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"internal":"provider-secret-trace-id-abc"}`))
	}))
	defer srv.Close()

	lister := &fakeEndpointLister{rows: []model.IntegrationEndpoint{
		activeNajizEndpoint(tenant, map[string]any{"base_url": srv.URL}),
	}}
	a := newNajizAdapterForTest(lister, srv.Client(), nil)

	_, err := a.SyncCase(context.Background(), tenant, NajizCaseSyncRequest{})
	if err == nil {
		t.Fatalf("expected rejection on 403")
	}
	if strings.Contains(err.Error(), "provider-secret-trace-id") {
		t.Fatalf("error leaked provider internals: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("4xx must not retry, got %d attempts", got)
	}
}

func TestNajiz_ContextTimeout(t *testing.T) {
	tenant := uuid.New()
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		<-release
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	defer close(release)

	lister := &fakeEndpointLister{rows: []model.IntegrationEndpoint{
		activeNajizEndpoint(tenant, map[string]any{"base_url": srv.URL}),
	}}
	a := newNajizAdapterForTest(lister, srv.Client(), nil)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := a.SyncCase(ctx, tenant, NajizCaseSyncRequest{})
	if err == nil {
		t.Fatalf("expected context timeout error")
	}
}

// --- sandbox / mock -----------------------------------------------------------

func TestNajiz_SandboxSync_MockTransport(t *testing.T) {
	tenant := uuid.New()
	// Sandbox endpoint with NO base_url at all: must still serve a mock read.
	lister := &fakeEndpointLister{rows: []model.IntegrationEndpoint{
		activeNajizEndpoint(tenant, map[string]any{"sandbox": true}),
	}}
	a := newNajizAdapterForTest(lister, nil, nil)

	res, err := a.SyncCase(context.Background(), tenant, NajizCaseSyncRequest{CaseID: uuid.New(), NajizReference: "MOJ-77"})
	if err != nil {
		t.Fatalf("sandbox SyncCase: %v", err)
	}
	if !res.Sandbox {
		t.Fatalf("sandbox result must be flagged Sandbox=true")
	}
	if res.Reference != "MOJ-77" || len(res.Hearings) == 0 {
		t.Fatalf("sandbox payload not shaped: %+v", res)
	}
	if note, _ := res.Metadata["najiz_note"].(string); !strings.Contains(note, "NOT a live") {
		t.Fatalf("sandbox metadata must declare it is not live, got %q", note)
	}

	h := a.Health(context.Background(), tenant)
	if !h.Sandbox || !h.Configured {
		t.Fatalf("sandbox health: %+v", h)
	}
}

// --- config / helpers ---------------------------------------------------------

func TestNajiz_ConfigBool_Tolerant(t *testing.T) {
	cases := []struct {
		val  any
		want bool
	}{
		{true, true}, {false, false}, {"true", true}, {"YES", true},
		{"1", true}, {"off", false}, {float64(1), true}, {float64(0), false}, {2, true},
	}
	for _, c := range cases {
		got := configBool(map[string]any{"allow_writes": c.val}, "allow_writes")
		if got != c.want {
			t.Fatalf("configBool(%v): got %v want %v", c.val, got, c.want)
		}
	}
}

func TestNajiz_IdempotencyKey_Deterministic(t *testing.T) {
	tenant := uuid.New()
	d := uuid.New()
	req := NajizRepresentativeRequest{DefendantCaseID: d, CompanyRepresentative: "  Rep One ", NationalID: "1"}
	k1 := najizIdempotencyKey(tenant, req)
	// Casing/whitespace on representative must not change the key.
	req2 := NajizRepresentativeRequest{DefendantCaseID: d, CompanyRepresentative: "rep one", NationalID: "1"}
	k2 := najizIdempotencyKey(tenant, req2)
	if k1 != k2 {
		t.Fatalf("idempotency key must be normalization-stable: %q vs %q", k1, k2)
	}
	// Different defendant -> different key.
	if najizIdempotencyKey(tenant, NajizRepresentativeRequest{DefendantCaseID: uuid.New(), CompanyRepresentative: "rep one"}) == k1 {
		t.Fatalf("different defendant must yield different key")
	}
	if !strings.HasPrefix(k1, "najiz-rep-") {
		t.Fatalf("unexpected key shape %q", k1)
	}
}

func TestNajiz_QueryEscape(t *testing.T) {
	if got := neturlQueryEscape("a b&c=d"); got != "a%20b%26c%3Dd" {
		t.Fatalf("escape: %q", got)
	}
}

func TestNajiz_ParseRetryAfter(t *testing.T) {
	if d := parseNajizRetryAfter("3"); d != 3*time.Second {
		t.Fatalf("retry-after 3 -> %v", d)
	}
	if d := parseNajizRetryAfter(""); d != 0 {
		t.Fatalf("empty -> %v", d)
	}
	if d := parseNajizRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT"); d != 0 {
		t.Fatalf("http-date should be ignored -> %v", d)
	}
}

// Ensure the adapter satisfies the port (also covered by compile assertion).
var _ NajizCourtPort = (*HTTPNajizCourtAdapter)(nil)
