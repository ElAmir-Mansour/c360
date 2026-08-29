package ransomware

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/repository"
)

const handlerTenant = "aaaaaaaa-0000-0000-0000-000000000001"
const handlerStream = "cccccccc-0000-0000-0000-000000000001"

// fakeReader is an in-memory SignalReader recording the calls the handler makes.
type fakeReader struct {
	all      []Signal
	byStream map[string][]Signal

	lastLimit  int
	lastStream string
	err        error
}

func (f *fakeReader) ListSignals(_ context.Context, _ repository.DBTX, _ string, limit int) ([]Signal, error) {
	f.lastLimit = limit
	f.lastStream = ""
	return f.all, f.err
}

func (f *fakeReader) ListSignalsByStream(_ context.Context, _ repository.DBTX, _ string, streamID string, limit int) ([]Signal, error) {
	f.lastLimit = limit
	f.lastStream = streamID
	return f.byStream[streamID], f.err
}

// fakeTenantReader runs fn with a nil DBTX (the fake reader ignores it) so the
// handler's tenant-scoped read path is exercised without a database.
type fakeTenantReader struct {
	gotTenant uuid.UUID
}

func (f *fakeTenantReader) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	f.gotTenant = tenantID
	return fn(nil)
}

func newHandlerTest(reader SignalReader) (*Handler, *fakeTenantReader) {
	tr := &fakeTenantReader{}
	return NewHandler(reader, tr, zerolog.Nop()), tr
}

// authedRequest builds a request carrying an authenticated viewer (which holds
// dr:read) for the given tenant, so RequirePermission and suiteapi.TenantID pass.
func authedRequest(method, target, tenant string, roles []string) *http.Request {
	req := httptest.NewRequest(method, target, nil)
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "11111111-1111-1111-1111-111111111111",
		TenantID: tenant,
		Roles:    roles,
	})
	ctx = auth.WithTenantID(ctx, tenant)
	return req.WithContext(ctx)
}

func sampleSignals(now time.Time) []Signal {
	return []Signal{
		{ID: "s1", TenantID: handlerTenant, StreamID: handlerStream, Kind: SignalEntropy, Severity: SeverityConfirmed, Observed: 7.9, Threshold: 7.5, CuratedRecoveryPointID: "rp-clean", ObservedAt: now, CreatedAt: now},
		{ID: "s2", TenantID: handlerTenant, StreamID: handlerStream, Kind: SignalByteRate, Severity: SeverityConfirmed, Observed: 1e6, Ratio: 20, Threshold: 5, ObservedAt: now, CreatedAt: now},
	}
}

func decodeData(t *testing.T, body []byte) []Signal {
	t.Helper()
	var env struct {
		Data []Signal `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode response: %v (body=%s)", err, string(body))
	}
	return env.Data
}

func TestHandler_ListSignals_OK(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	reader := &fakeReader{all: sampleSignals(now)}
	h, tr := newHandlerTest(reader)

	rec := httptest.NewRecorder()
	req := authedRequest(http.MethodGet, "/ransomware/signals", handlerTenant, []string{"viewer"})
	h.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	got := decodeData(t, rec.Body.Bytes())
	if len(got) != 2 || got[0].Kind != SignalEntropy {
		t.Fatalf("unexpected signals: %+v", got)
	}
	if reader.lastLimit != 100 {
		t.Fatalf("default limit = %d, want 100", reader.lastLimit)
	}
	if tr.gotTenant.String() != handlerTenant {
		t.Fatalf("tenant-scoped read used tenant %s, want %s", tr.gotTenant, handlerTenant)
	}
}

func TestHandler_ListSignals_StreamFilterAndLimit(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	reader := &fakeReader{byStream: map[string][]Signal{handlerStream: sampleSignals(now)[:1]}}
	h, _ := newHandlerTest(reader)

	rec := httptest.NewRecorder()
	req := authedRequest(http.MethodGet, "/ransomware/signals?stream_id="+handlerStream+"&limit=25", handlerTenant, []string{"analyst"})
	h.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	got := decodeData(t, rec.Body.Bytes())
	if len(got) != 1 {
		t.Fatalf("expected the stream-filtered single signal, got %d", len(got))
	}
	if reader.lastStream != handlerStream {
		t.Fatalf("stream filter not applied, lastStream=%q", reader.lastStream)
	}
	if reader.lastLimit != 25 {
		t.Fatalf("limit = %d, want 25", reader.lastLimit)
	}
}

func TestHandler_ListSignals_LimitClampedAndDefaulted(t *testing.T) {
	t.Parallel()
	reader := &fakeReader{}
	h, _ := newHandlerTest(reader)

	cases := map[string]int{
		"/ransomware/signals?limit=999999": 1000, // clamped to max
		"/ransomware/signals?limit=0":      100,  // non-positive -> default
		"/ransomware/signals?limit=abc":    100,  // unparseable -> default
		"/ransomware/signals?limit=250":    250,  // within range
	}
	for target, want := range cases {
		rec := httptest.NewRecorder()
		req := authedRequest(http.MethodGet, target, handlerTenant, []string{"viewer"})
		h.Routes().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", target, rec.Code)
		}
		if reader.lastLimit != want {
			t.Fatalf("%s: limit = %d, want %d", target, reader.lastLimit, want)
		}
	}
}

func TestHandler_ListStreamSignals_OK(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	reader := &fakeReader{byStream: map[string][]Signal{handlerStream: sampleSignals(now)}}
	h, _ := newHandlerTest(reader)

	rec := httptest.NewRecorder()
	req := authedRequest(http.MethodGet, "/ransomware/streams/"+handlerStream+"/signals", handlerTenant, []string{"viewer"})
	h.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	got := decodeData(t, rec.Body.Bytes())
	if len(got) != 2 {
		t.Fatalf("expected 2 signals for the stream, got %d", len(got))
	}
	if reader.lastStream != handlerStream {
		t.Fatalf("stream id not propagated, got %q", reader.lastStream)
	}
}

func TestHandler_ListStreamSignals_BadStreamID(t *testing.T) {
	t.Parallel()
	h, _ := newHandlerTest(&fakeReader{})

	rec := httptest.NewRecorder()
	req := authedRequest(http.MethodGet, "/ransomware/streams/not-a-uuid/signals", handlerTenant, []string{"viewer"})
	h.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for a non-UUID stream id", rec.Code)
	}
}

func TestHandler_RequiresPermission(t *testing.T) {
	t.Parallel()
	h, _ := newHandlerTest(&fakeReader{})

	rec := httptest.NewRecorder()
	// A user with no dr:read-bearing role is forbidden.
	req := authedRequest(http.MethodGet, "/ransomware/signals", handlerTenant, []string{"none"})
	h.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 without dr:read", rec.Code)
	}
}

func TestHandler_Unauthenticated(t *testing.T) {
	t.Parallel()
	h, _ := newHandlerTest(&fakeReader{})

	rec := httptest.NewRecorder()
	// No auth user in context at all.
	req := httptest.NewRequest(http.MethodGet, "/ransomware/signals", nil)
	h.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 unauthenticated", rec.Code)
	}
}

func TestHandler_EmptyResultIsEmptyArray(t *testing.T) {
	t.Parallel()
	reader := &fakeReader{all: nil} // store returns no signals
	h, _ := newHandlerTest(reader)

	rec := httptest.NewRecorder()
	req := authedRequest(http.MethodGet, "/ransomware/signals", handlerTenant, []string{"viewer"})
	h.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	// Must serialize as [] not null so the dashboard can iterate.
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if string(env.Data) != "[]" {
		t.Fatalf("empty data = %s, want []", string(env.Data))
	}
}

// Compile-time guarantee the handler reader contract is satisfied by the Store.
var _ SignalReader = (*Store)(nil)
