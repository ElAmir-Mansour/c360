package integration

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// fixedNow returns a deterministic clock for signature/timestamp assertions.
func fixedNow(t time.Time) func() time.Time { return func() time.Time { return t } }

// newTestInternalConnector builds a connector with a deterministic clock and an
// HTTP client whose timeout is generous (per-call timeouts come from cfg).
func newTestInternalConnector(now time.Time) *InternalRESTConnector {
	return &InternalRESTConnector{
		client: &http.Client{Timeout: 5 * time.Second},
		logger: zerolog.Nop(),
		now:    fixedNow(now),
	}
}

func internalEndpoint(t *testing.T, status model.IntegrationStatus, config map[string]any) model.IntegrationEndpoint {
	t.Helper()
	return model.IntegrationEndpoint{
		ID:       uuid.New(),
		TenantID: uuid.New(),
		Kind:     model.IntegrationKindInternal,
		Code:     "internal-test",
		Status:   status,
		Config:   config,
	}
}

// -----------------------------------------------------------------------------
// HMAC sign + verify (accept valid, reject tampered) — outbound signing path.
// -----------------------------------------------------------------------------

func TestInvokeSignsBodyWithHMAC_ReceiverVerifies(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	const secret = "top-secret-signing-key"

	var (
		gotSig        string
		gotTs         string
		gotIdem       string
		gotIdemStd    string
		receivedBody  []byte
		verifiedValid bool
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		receivedBody = body
		gotSig = r.Header.Get("X-Clario-Signature")
		gotTs = r.Header.Get("X-Clario-Timestamp")
		gotIdem = r.Header.Get("X-Clario-Idempotency-Key")
		gotIdemStd = r.Header.Get("Idempotency-Key")

		// The receiver independently verifies the signature over (ts + "." + body).
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(gotTs))
		mac.Write([]byte("."))
		mac.Write(body)
		expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
		verifiedValid = hmac.Equal([]byte(expected), []byte(gotSig))

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"reference":"REF-123"}`))
	}))
	defer srv.Close()

	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{
		"base_url":    srv.URL,
		"auth":        "hmac",
		"hmac_secret": secret,
	})

	res, err := conn.Invoke(context.Background(), ep, InternalOpNotify, map[string]any{"hello": "world"})
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if !res.Success {
		t.Fatalf("expected success, got %+v", res)
	}
	if res.Reference != "REF-123" {
		t.Fatalf("expected reference REF-123, got %q", res.Reference)
	}
	if !verifiedValid {
		t.Fatalf("receiver could not verify the signature: sig=%q ts=%q", gotSig, gotTs)
	}
	if !strings.HasPrefix(gotSig, "sha256=") {
		t.Fatalf("signature header missing sha256= prefix: %q", gotSig)
	}
	if gotIdem == "" || gotIdemStd == "" || gotIdem != gotIdemStd {
		t.Fatalf("idempotency headers absent or mismatched: x=%q std=%q", gotIdem, gotIdemStd)
	}
	// The signature must be over the EXACT bytes the server received.
	if !verifyInternalSignature(secret, receivedBody, gotTs, gotSig, now) {
		t.Fatalf("verifyInternalSignature rejected the connector's own signature")
	}
}

func TestVerifyInternalSignature_AcceptsValidRejectsTampered(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	const secret = "hmac-key"
	body := []byte(`{"event":"case.updated","id":"42"}`)
	ts := strconv.FormatInt(now.Unix(), 10)

	good := "sha256=" + signInternalBody(secret, ts, body)

	if !verifyInternalSignature(secret, body, ts, good, now) {
		t.Fatalf("valid signature was rejected")
	}

	// Tampered body must fail.
	if verifyInternalSignature(secret, []byte(`{"event":"case.deleted","id":"42"}`), ts, good, now) {
		t.Fatalf("tampered body accepted")
	}
	// Tampered signature must fail.
	tampered := good[:len(good)-1] + "0"
	if tampered == good {
		tampered = good[:len(good)-1] + "1"
	}
	if verifyInternalSignature(secret, body, ts, tampered, now) {
		t.Fatalf("tampered signature accepted")
	}
	// Wrong secret must fail.
	if verifyInternalSignature("other-key", body, ts, good, now) {
		t.Fatalf("signature verified under wrong secret")
	}
	// Empty signature / secret must fail-closed.
	if verifyInternalSignature(secret, body, ts, "", now) {
		t.Fatalf("empty signature accepted")
	}
	if verifyInternalSignature("", body, ts, good, now) {
		t.Fatalf("empty secret accepted")
	}
}

func TestVerifyInternalSignature_StaleTimestampRejected(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	const secret = "hmac-key"
	body := []byte(`{"x":1}`)
	staleTs := strconv.FormatInt(now.Add(-10*time.Minute).Unix(), 10)
	// Signature computed correctly for the stale timestamp.
	sig := "sha256=" + signInternalBody(secret, staleTs, body)
	if verifyInternalSignature(secret, body, staleTs, sig, now) {
		t.Fatalf("stale timestamp beyond tolerance was accepted (replay window not enforced)")
	}
}

func TestVerifyInternalSignature_BodyOnlyFallback(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	const secret = "hmac-key"
	body := []byte(`{"x":1}`)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	// No timestamp -> body-only verification path.
	if !verifyInternalSignature(secret, body, "", sig, now) {
		t.Fatalf("body-only signature (no timestamp) was rejected")
	}
}

// -----------------------------------------------------------------------------
// Inbound webhook verification through the resolver seam.
// -----------------------------------------------------------------------------

type fakeResolver struct {
	endpoint *model.IntegrationEndpoint
	err      error
}

func (f fakeResolver) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.IntegrationEndpoint, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.endpoint, nil
}

func (f fakeResolver) List(ctx context.Context, tenantID uuid.UUID, kind, status string) ([]model.IntegrationEndpoint, error) {
	return nil, nil
}

func TestVerifyInboundWebhook_AcceptValidRejectTampered(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	const secret = "inbound-secret"
	tenantID := uuid.New()
	endpointID := uuid.New()

	ep := &model.IntegrationEndpoint{
		ID:       endpointID,
		TenantID: tenantID,
		Kind:     model.IntegrationKindInternal,
		Status:   model.IntegrationStatusActive,
		Config:   map[string]any{"hmac_secret": secret},
	}

	conn := newTestInternalConnector(now)
	conn.endpoints = fakeResolver{endpoint: ep}

	body := []byte(`{"event":"ping"}`)
	ts := strconv.FormatInt(now.Unix(), 10)
	sig := "sha256=" + signInternalBody(secret, ts, body)

	got, err := conn.VerifyInboundWebhook(context.Background(), tenantID, endpointID, body, sig, ts)
	if err != nil {
		t.Fatalf("valid webhook rejected: %v", err)
	}
	if got == nil || got.ID != endpointID {
		t.Fatalf("expected resolved endpoint, got %+v", got)
	}

	// Tampered body -> uniform unauthorized.
	_, err = conn.VerifyInboundWebhook(context.Background(), tenantID, endpointID, []byte(`{"event":"pong"}`), sig, ts)
	if !errors.Is(err, ErrInternalWebhookUnauthorized) {
		t.Fatalf("expected ErrInternalWebhookUnauthorized for tampered body, got %v", err)
	}

	// Missing signature -> fail-closed.
	_, err = conn.VerifyInboundWebhook(context.Background(), tenantID, endpointID, body, "", ts)
	if !errors.Is(err, ErrInternalWebhookUnauthorized) {
		t.Fatalf("expected unauthorized for missing signature, got %v", err)
	}
}

func TestVerifyInboundWebhook_FailClosedConditions(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	tenantID := uuid.New()
	endpointID := uuid.New()
	body := []byte(`{"e":1}`)

	// No resolver wired -> not configured.
	conn := newTestInternalConnector(now)
	if _, err := conn.VerifyInboundWebhook(context.Background(), tenantID, endpointID, body, "sha256=x", ""); !errors.Is(err, ErrInternalRESTNotConfigured) {
		t.Fatalf("expected not-configured with nil resolver, got %v", err)
	}

	// Unknown endpoint -> de-oracled to unauthorized (NOT a distinct "not found").
	conn2 := newTestInternalConnector(now)
	conn2.endpoints = fakeResolver{err: errors.New("no rows")}
	if _, err := conn2.VerifyInboundWebhook(context.Background(), tenantID, endpointID, body, "sha256=x", ""); !errors.Is(err, ErrInternalWebhookUnauthorized) {
		t.Fatalf("expected unauthorized for unknown endpoint, got %v", err)
	}

	// Wrong kind -> unauthorized.
	conn3 := newTestInternalConnector(now)
	conn3.endpoints = fakeResolver{endpoint: &model.IntegrationEndpoint{
		ID: endpointID, TenantID: tenantID, Kind: model.IntegrationKindNajiz,
		Status: model.IntegrationStatusActive, Config: map[string]any{"hmac_secret": "s"},
	}}
	if _, err := conn3.VerifyInboundWebhook(context.Background(), tenantID, endpointID, body, "sha256=x", ""); !errors.Is(err, ErrInternalWebhookUnauthorized) {
		t.Fatalf("expected unauthorized for wrong kind, got %v", err)
	}

	// Disabled endpoint -> unauthorized.
	conn4 := newTestInternalConnector(now)
	conn4.endpoints = fakeResolver{endpoint: &model.IntegrationEndpoint{
		ID: endpointID, TenantID: tenantID, Kind: model.IntegrationKindInternal,
		Status: model.IntegrationStatusDisabled, Config: map[string]any{"hmac_secret": "s"},
	}}
	if _, err := conn4.VerifyInboundWebhook(context.Background(), tenantID, endpointID, body, "sha256=x", ""); !errors.Is(err, ErrInternalWebhookUnauthorized) {
		t.Fatalf("expected unauthorized for disabled endpoint, got %v", err)
	}

	// Active but no hmac_secret -> not configured.
	conn5 := newTestInternalConnector(now)
	conn5.endpoints = fakeResolver{endpoint: &model.IntegrationEndpoint{
		ID: endpointID, TenantID: tenantID, Kind: model.IntegrationKindInternal,
		Status: model.IntegrationStatusActive, Config: map[string]any{},
	}}
	if _, err := conn5.VerifyInboundWebhook(context.Background(), tenantID, endpointID, body, "sha256=x", ""); !errors.Is(err, ErrInternalRESTNotConfigured) {
		t.Fatalf("expected not-configured for missing hmac_secret, got %v", err)
	}
}

// -----------------------------------------------------------------------------
// Egress policy — host allow-list block.
// -----------------------------------------------------------------------------

func TestInvoke_HostEgressDenied(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{
		"base_url":             srv.URL,
		"auth":                 "none",
		"allowed_egress_hosts": []any{"allowed.internal.example", "another.host"},
	})

	_, err := conn.Invoke(context.Background(), ep, InternalOpPost, map[string]any{"x": 1})
	if !errors.Is(err, ErrInternalEgressDenied) {
		t.Fatalf("expected ErrInternalEgressDenied, got %v", err)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("connection was opened to a disallowed host (egress fence breached): %d hits", hits)
	}
}

func TestInvoke_HostEgressAllowed(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"OK-1"}`))
	}))
	defer srv.Close()

	// Pin the actual test-server host into the allow-list so the call passes.
	host := strings.TrimPrefix(srv.URL, "http://")
	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{
		"base_url":             srv.URL,
		"auth":                 "none",
		"allowed_egress_hosts": []any{host},
	})

	res, err := conn.Invoke(context.Background(), ep, InternalOpPost, map[string]any{"x": 1})
	if err != nil {
		t.Fatalf("Invoke with allowed host failed: %v", err)
	}
	if !res.Success || res.Reference != "OK-1" {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestHostAllowed_UnconstrainedAndFailClosed(t *testing.T) {
	// Empty allow-list => unconstrained.
	cfg := internalConfig{}
	if !cfg.hostAllowed("https://anything.example/path") {
		t.Fatalf("empty allow-list should be unconstrained")
	}
	// Unparseable URL with a non-empty allow-list => fail-closed.
	cfg2 := internalConfig{AllowedHosts: []string{"x.example"}}
	if cfg2.hostAllowed("://%%%bad") {
		t.Fatalf("unparseable URL should be denied fail-closed")
	}
}

// -----------------------------------------------------------------------------
// Retry / timeout behaviour.
// -----------------------------------------------------------------------------

func TestInvoke_RetriesOn5xxThenSucceeds(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"done"}`))
	}))
	defer srv.Close()

	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{
		"base_url": srv.URL,
		"auth":     "none",
		"retry":    3,
	})

	res, err := conn.Invoke(context.Background(), ep, InternalOpPost, map[string]any{"x": 1})
	if err != nil {
		t.Fatalf("expected eventual success after retries, got %v", err)
	}
	if !res.Success || res.Reference != "done" {
		t.Fatalf("unexpected result %+v", res)
	}
	if atomic.LoadInt32(&calls) != 3 {
		t.Fatalf("expected 3 attempts (2 failures + 1 success), got %d", calls)
	}
}

func TestInvoke_4xxNotRetried(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{
		"base_url": srv.URL,
		"auth":     "none",
		"retry":    3,
	})

	_, err := conn.Invoke(context.Background(), ep, InternalOpPost, map[string]any{"x": 1})
	if err == nil {
		t.Fatalf("expected error on 4xx")
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("4xx must NOT be retried; got %d attempts", calls)
	}
}

func TestInvoke_ContextTimeoutHonored(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{
		"base_url":        srv.URL,
		"auth":            "none",
		"timeout_seconds": 0, // default 15s outer; we cap via ctx below
	})

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err := conn.Invoke(ctx, ep, InternalOpPost, map[string]any{"x": 1})
	if err == nil {
		t.Fatalf("expected timeout error")
	}
	if time.Since(start) > 1500*time.Millisecond {
		t.Fatalf("context timeout not honored; call ran %s", time.Since(start))
	}
}

// -----------------------------------------------------------------------------
// Idempotency key — stable across identical retries, distinct across payloads.
// -----------------------------------------------------------------------------

func TestInvoke_IdempotencyKeyStableAcrossRetries(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	var keys []string
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		keys = append(keys, r.Header.Get("Idempotency-Key"))
		if atomic.AddInt32(&calls, 1) < 2 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{
		"base_url": srv.URL,
		"auth":     "none",
		"retry":    2,
	})
	if _, err := conn.Invoke(context.Background(), ep, InternalOpPost, map[string]any{"x": 1}); err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if len(keys) < 2 {
		t.Fatalf("expected at least 2 attempts, saw %d", len(keys))
	}
	for i := 1; i < len(keys); i++ {
		if keys[i] != keys[0] || keys[0] == "" {
			t.Fatalf("idempotency key changed across retries: %v", keys)
		}
	}

	// A different payload yields a different key.
	k1 := internalIdempotencyKey(ep, InternalOpPost, []byte(`a`))
	k2 := internalIdempotencyKey(ep, InternalOpPost, []byte(`b`))
	if k1 == k2 {
		t.Fatalf("distinct payloads must produce distinct idempotency keys")
	}
}

// -----------------------------------------------------------------------------
// Redaction — secrets never appear in results or error details.
// -----------------------------------------------------------------------------

func TestInvoke_NoSecretLeakInResultsOrErrors(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	const secret = "SUPER-SECRET-BEARER-TOKEN"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized) // 4xx surfaces an error path
	}))
	defer srv.Close()

	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{
		"base_url":     srv.URL,
		"auth":         "bearer",
		"bearer_token": secret,
		"hmac_secret":  "ANOTHER-SECRET",
	})

	res, err := conn.Invoke(context.Background(), ep, InternalOpPost, map[string]any{"x": 1})
	if err == nil {
		t.Fatalf("expected error on 401")
	}
	if strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "ANOTHER-SECRET") {
		t.Fatalf("secret leaked in error: %v", err)
	}
	blob, _ := json.Marshal(res)
	if strings.Contains(string(blob), secret) || strings.Contains(string(blob), "ANOTHER-SECRET") {
		t.Fatalf("secret leaked in InvokeResult: %s", blob)
	}

	// TestConnection path likewise must not echo secrets.
	tr, _ := conn.TestConnection(context.Background(), ep)
	trBlob, _ := json.Marshal(tr)
	if strings.Contains(string(trBlob), secret) || strings.Contains(string(trBlob), "ANOTHER-SECRET") {
		t.Fatalf("secret leaked in TestResult: %s", trBlob)
	}
}

// -----------------------------------------------------------------------------
// Honest health / not-configured behaviour (no fake success).
// -----------------------------------------------------------------------------

func TestProbe_NotConfiguredWhenNoBaseURL(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{})
	h := conn.Probe(context.Background(), ep, now)
	if h.Reachable {
		t.Fatalf("active endpoint with no base_url must NOT be reachable")
	}
	if !strings.Contains(h.Detail, "not_configured") {
		t.Fatalf("expected not_configured detail, got %q", h.Detail)
	}
}

func TestProbe_PlannedNotConfigured(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusPlanned, map[string]any{"base_url": "https://x"})
	h := conn.Probe(context.Background(), ep, now)
	if h.Reachable {
		t.Fatalf("planned endpoint must not be reachable")
	}
}

func TestProbe_HealthyOn2xx(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{
		"base_url": srv.URL,
		"auth":     "none",
	})
	h := conn.Probe(context.Background(), ep, now)
	if !h.Reachable {
		t.Fatalf("expected reachable on 2xx, got %q", h.Detail)
	}
}

func TestInvoke_UnsupportedOperation(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{"base_url": "https://x", "auth": "none"})
	_, err := conn.Invoke(context.Background(), ep, "delete-everything", nil)
	if !errors.Is(err, ErrCapabilityNotSupported) {
		t.Fatalf("expected ErrCapabilityNotSupported, got %v", err)
	}
}
