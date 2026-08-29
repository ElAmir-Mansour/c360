package integration

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// newTestConnector builds a connector with no repo (so resolvePlaintext echoes the
// passed endpoint) and the default HTTP client, suitable for httptest servers.
func newTestConnector() *NafathVerifyConnector {
	return NewNafathVerifyConnector(NafathVerifyConnectorConfig{
		Logger:  zerolog.Nop(),
		Timeout: 3 * time.Second,
	})
}

func prodEndpoint(baseURL string, extra map[string]any) model.IntegrationEndpoint {
	cfg := map[string]any{
		"environment":   "production",
		"base_url":      baseURL,
		"sp_api_key":    "sp-key-SECRET",
		"sp_api_secret": "sp-secret-SECRET",
		"sp_id":         "SP-001",
		"max_retries":   float64(0),
	}
	for k, v := range extra {
		cfg[k] = v
	}
	return model.IntegrationEndpoint{
		ID:       uuid.New(),
		TenantID: uuid.New(),
		Code:     "nafath-prod",
		Status:   model.IntegrationStatusActive,
		Config:   cfg,
	}
}

// ----------------------------------------------------------------------------
// request / status / details (live transport via httptest)
// ----------------------------------------------------------------------------

func TestLiveRequest_HappyPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/ExtNafath/request") {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		// SP credentials must be sent on the wire.
		if r.Header.Get("apiKey") == "" {
			t.Error("expected apiKey header")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"transId": "T-123", "random": "42"})
	}))
	defer srv.Close()

	c := newTestConnector()
	res, err := c.Invoke(context.Background(), prodEndpoint(srv.URL, nil), NafathOpRequest, map[string]any{"national_id": "1000000000"})
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if !res.Success || res.Reference != "T-123" {
		t.Fatalf("unexpected result: %+v", res)
	}
	if res.Output["random"] != "42" {
		t.Errorf("expected number-match random=42, got %v", res.Output["random"])
	}
}

func TestLiveRequest_MissingNationalID(t *testing.T) {
	c := newTestConnector()
	res, err := c.Invoke(context.Background(), prodEndpoint("http://example.invalid", nil), NafathOpRequest, map[string]any{})
	if err == nil || res.Success {
		t.Fatalf("expected validation error, got %+v / %v", res, err)
	}
}

func TestLiveStatus_VerifiedWithNumberMatch_ValidEsignBasis(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "COMPLETED", "acr": "numberMatch"})
	}))
	defer srv.Close()

	c := newTestConnector()
	res, err := c.Invoke(context.Background(), prodEndpoint(srv.URL, nil), NafathOpStatus, map[string]any{"trans_id": "T-1"})
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if res.Output["status"] != string(NafathStatusVerified) {
		t.Fatalf("expected verified, got %v", res.Output["status"])
	}
	if res.Output["valid_esign_basis"] != true {
		t.Errorf("expected valid_esign_basis=true at number_match, got %v", res.Output["valid_esign_basis"])
	}
	if res.Output["loa"] != string(NafathLoANumberMatch) {
		t.Errorf("expected loa=number_match, got %v", res.Output["loa"])
	}
}

// LoA enforcement: a COMPLETED transaction at a level BELOW the minimum is NOT a
// valid e-sign basis (fail-closed).
func TestLiveStatus_VerifiedButLoABelowMinimum_Rejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "COMPLETED", "acr": "otp"})
	}))
	defer srv.Close()

	c := newTestConnector()
	res, _ := c.Invoke(context.Background(), prodEndpoint(srv.URL, nil), NafathOpStatus, map[string]any{"trans_id": "T-2"})
	if res.Output["status"] != string(NafathStatusVerified) {
		t.Fatalf("expected status verified, got %v", res.Output["status"])
	}
	if res.Output["valid_esign_basis"] != false {
		t.Errorf("single_factor must NOT be a valid e-sign basis, got %v", res.Output["valid_esign_basis"])
	}
}

// Fail-closed: COMPLETED with NO assurance field at all is rejected as a basis.
func TestLiveStatus_VerifiedNoLoA_FailClosed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "COMPLETED"})
	}))
	defer srv.Close()

	c := newTestConnector()
	res, _ := c.Invoke(context.Background(), prodEndpoint(srv.URL, nil), NafathOpStatus, map[string]any{"trans_id": "T-3"})
	if res.Output["valid_esign_basis"] != false {
		t.Errorf("missing LoA must fail closed, got valid_esign_basis=%v", res.Output["valid_esign_basis"])
	}
	if res.Output["loa"] != string(NafathLoANone) {
		t.Errorf("expected loa=none, got %v", res.Output["loa"])
	}
}

// Operator may RAISE the bar to biometric; number_match then fails.
func TestLiveStatus_ConfiguredBiometric_NumberMatchInsufficient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "COMPLETED", "acr": "numberMatch"})
	}))
	defer srv.Close()

	ep := prodEndpoint(srv.URL, map[string]any{"minimum_loa": "biometric"})
	c := newTestConnector()
	res, _ := c.Invoke(context.Background(), ep, NafathOpStatus, map[string]any{"trans_id": "T-4"})
	if res.Output["valid_esign_basis"] != false {
		t.Errorf("number_match must be insufficient when minimum is biometric, got %v", res.Output["valid_esign_basis"])
	}
	if res.Output["minimum_loa"] != string(NafathLoABiometric) {
		t.Errorf("expected minimum_loa=biometric, got %v", res.Output["minimum_loa"])
	}
}

// Operator CANNOT lower below the number-match floor: a configured single_factor
// minimum is clamped back up.
func TestResolveMinimumLoA_ClampedToFloor(t *testing.T) {
	cfg := parseNafathConfig(map[string]any{"minimum_loa": "otp"})
	if got := resolveMinimumLoA(cfg); got != DefaultNafathMinimumLoA {
		t.Fatalf("expected clamp to %q, got %q", DefaultNafathMinimumLoA, got)
	}
}

func TestLiveStatus_MissingTransID(t *testing.T) {
	c := newTestConnector()
	res, err := c.Invoke(context.Background(), prodEndpoint("http://example.invalid", nil), NafathOpStatus, map[string]any{})
	if err == nil || res.Success {
		t.Fatalf("expected error for missing trans_id")
	}
}

func TestLiveDetails_GatesLoA(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"nationalId": "1000000000", "fullNameEn": "Test", "acr": "numberMatch",
		})
	}))
	defer srv.Close()

	c := newTestConnector()
	res, err := c.Invoke(context.Background(), prodEndpoint(srv.URL, nil), NafathOpDetails, map[string]any{"trans_id": "T-5"})
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if res.Output["loa_satisfied"] != true {
		t.Errorf("expected loa_satisfied=true, got %v", res.Output["loa_satisfied"])
	}
}

// Details must redact any secret-looking attribute defensively.
func TestLiveDetails_RedactsSecrets(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"nationalId": "1000000000", "apiKey": "LEAK", "access_token": "LEAK",
		})
	}))
	defer srv.Close()

	c := newTestConnector()
	res, _ := c.Invoke(context.Background(), prodEndpoint(srv.URL, nil), NafathOpDetails, map[string]any{"trans_id": "T-6"})
	attrs, _ := res.Output["attributes"].(map[string]any)
	if _, ok := attrs["apiKey"]; ok {
		t.Error("apiKey must be redacted from details")
	}
	if _, ok := attrs["access_token"]; ok {
		t.Error("access_token must be redacted from details")
	}
}

// ----------------------------------------------------------------------------
// Error mapping / no provider-internal leakage
// ----------------------------------------------------------------------------

func TestLiveStatus_4xxNotRetried_SanitizedError(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		http.Error(w, `{"internal":"stacktrace secret"}`, http.StatusUnauthorized)
	}))
	defer srv.Close()

	ep := prodEndpoint(srv.URL, map[string]any{"max_retries": float64(3)})
	c := newTestConnector()
	res, err := c.Invoke(context.Background(), ep, NafathOpStatus, map[string]any{"trans_id": "T-7"})
	if err == nil || res.Success {
		t.Fatalf("expected failure on 401")
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Errorf("4xx must NOT be retried, got %d calls", calls)
	}
	if strings.Contains(res.Detail, "stacktrace") || strings.Contains(res.Detail, "secret") {
		t.Errorf("provider internals leaked into detail: %q", res.Detail)
	}
}

func TestLiveStatus_5xxRetriedThenSucceeds(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n < 3 {
			http.Error(w, "boom", http.StatusBadGateway)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "COMPLETED", "acr": "numberMatch"})
	}))
	defer srv.Close()

	ep := prodEndpoint(srv.URL, map[string]any{"max_retries": float64(3)})
	c := newTestConnector()
	res, err := c.Invoke(context.Background(), ep, NafathOpStatus, map[string]any{"trans_id": "T-8"})
	if err != nil {
		t.Fatalf("expected success after retries, got %v", err)
	}
	if res.Output["status"] != string(NafathStatusVerified) {
		t.Fatalf("unexpected status %v", res.Output["status"])
	}
	if atomic.LoadInt32(&calls) != 3 {
		t.Errorf("expected 3 attempts, got %d", calls)
	}
}

func TestLiveStatus_5xxExhaustsRetries(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	ep := prodEndpoint(srv.URL, map[string]any{"max_retries": float64(2)})
	c := newTestConnector()
	_, err := c.Invoke(context.Background(), ep, NafathOpStatus, map[string]any{"trans_id": "T-9"})
	if err == nil {
		t.Fatal("expected failure after exhausting retries")
	}
	if atomic.LoadInt32(&calls) != 3 { // initial + 2 retries
		t.Errorf("expected 3 attempts, got %d", calls)
	}
}

func TestNafathInvoke_UnsupportedOperation(t *testing.T) {
	c := newTestConnector()
	_, err := c.Invoke(context.Background(), prodEndpoint("http://x", nil), "frobnicate", nil)
	if err == nil {
		t.Fatal("expected error for unsupported operation")
	}
}

func TestInvoke_IncompleteConfig_HonestNotWired(t *testing.T) {
	ep := model.IntegrationEndpoint{
		ID: uuid.New(), TenantID: uuid.New(), Status: model.IntegrationStatusActive,
		Config: map[string]any{"environment": "production", "base_url": "https://nafath.example"},
	}
	c := newTestConnector()
	_, err := c.Invoke(context.Background(), ep, NafathOpRequest, map[string]any{"national_id": "1"})
	if err != ErrNafathConfigIncomplete {
		t.Fatalf("expected ErrNafathConfigIncomplete, got %v", err)
	}
}

// ----------------------------------------------------------------------------
// Honest health: never reports a live connection it does not have
// ----------------------------------------------------------------------------

func TestProbe_PlannedIsNotConfigured(t *testing.T) {
	ep := model.IntegrationEndpoint{ID: uuid.New(), Status: model.IntegrationStatusPlanned}
	h := newTestConnector().Probe(context.Background(), ep, time.Now())
	if h.Reachable {
		t.Error("planned endpoint must not be reachable")
	}
	if !strings.Contains(h.Detail, "Elm/TCC") {
		t.Errorf("expected gov-onboarding note, got %q", h.Detail)
	}
}

func TestProbe_SandboxIsNotConfigured_NeverHealthy(t *testing.T) {
	ep := model.IntegrationEndpoint{
		ID: uuid.New(), Status: model.IntegrationStatusActive,
		Config: map[string]any{"environment": "uat", "base_url": "https://uat.nafath", "sp_api_key": "k", "sp_api_secret": "s"},
	}
	h := newTestConnector().Probe(context.Background(), ep, time.Now())
	if h.Reachable {
		t.Fatal("UAT/sandbox must NEVER report a healthy live connection")
	}
	if !strings.Contains(strings.ToLower(h.Detail), "not_configured") {
		t.Errorf("expected not_configured grade, got %q", h.Detail)
	}
}

func TestTestConnection_SandboxNeverFakesSuccess(t *testing.T) {
	ep := model.IntegrationEndpoint{
		ID: uuid.New(), TenantID: uuid.New(), Status: model.IntegrationStatusActive,
		Config: map[string]any{"environment": "sandbox", "base_url": "https://s", "sp_api_key": "k", "sp_api_secret": "s"},
	}
	res, err := newTestConnector().TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	if res.Reachable {
		t.Fatal("sandbox must never report reachable=true")
	}
	if res.Metadata["grade"] != "not_configured" {
		t.Errorf("expected grade=not_configured, got %v", res.Metadata["grade"])
	}
}

func TestTestConnection_DoesNotEchoSecrets(t *testing.T) {
	ep := prodEndpoint("http://127.0.0.1:1", nil) // unreachable -> error path
	res, _ := newTestConnector().TestConnection(context.Background(), ep)
	blob, _ := json.Marshal(res)
	if strings.Contains(string(blob), "SECRET") {
		t.Errorf("secret leaked into TestResult: %s", blob)
	}
}

func TestProbe_ProductionReachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized) // any HTTP response proves reachability
	}))
	defer srv.Close()
	ep := prodEndpoint(srv.URL, nil)
	h := newTestConnector().Probe(context.Background(), ep, time.Now())
	if !h.Reachable {
		t.Errorf("a responding SP host must grade reachable, got %q", h.Detail)
	}
}

// ----------------------------------------------------------------------------
// Webhook signature verification (accept + reject) + LoA gating
// ----------------------------------------------------------------------------

func sign(secret string, body []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(body)
	return hex.EncodeToString(m.Sum(nil))
}

func TestVerifyNafathWebhook_AcceptsValidNumberMatch(t *testing.T) {
	secret := "whsec-123"
	body := []byte(`{"transId":"T-1","nationalId":"1000000000","status":"COMPLETED","acr":"numberMatch"}`)
	ev, err := VerifyNafathWebhook(secret, body, "sha256="+sign(secret, body), NafathLoANumberMatch, time.Now())
	if err != nil {
		t.Fatalf("expected accept, got %v", err)
	}
	if ev.Status != NafathStatusVerified || !ev.ValidEsignBasis {
		t.Fatalf("expected verified valid basis, got %+v", ev)
	}
	if ev.TransID != "T-1" {
		t.Errorf("expected trans id T-1, got %q", ev.TransID)
	}
}

func TestVerifyNafathWebhook_RejectsTamperedBody(t *testing.T) {
	secret := "whsec-123"
	body := []byte(`{"transId":"T-1","status":"COMPLETED","acr":"numberMatch"}`)
	sig := "sha256=" + sign(secret, body)
	tampered := []byte(`{"transId":"T-EVIL","status":"COMPLETED","acr":"numberMatch"}`)
	if _, err := VerifyNafathWebhook(secret, tampered, sig, NafathLoANumberMatch, time.Now()); err != ErrNafathWebhookSignature {
		t.Fatalf("tampered body must be rejected, got %v", err)
	}
}

func TestVerifyNafathWebhook_RejectsWrongSecret(t *testing.T) {
	body := []byte(`{"transId":"T-1","status":"COMPLETED"}`)
	sig := "sha256=" + sign("attacker-secret", body)
	if _, err := VerifyNafathWebhook("real-secret", body, sig, NafathLoANumberMatch, time.Now()); err != ErrNafathWebhookSignature {
		t.Fatalf("wrong secret must be rejected, got %v", err)
	}
}

func TestVerifyNafathWebhook_RejectsEmptySecret(t *testing.T) {
	body := []byte(`{}`)
	if _, err := VerifyNafathWebhook("", body, "sha256=deadbeef", NafathLoANumberMatch, time.Now()); err != ErrNafathWebhookSignature {
		t.Fatalf("empty secret must be rejected (fail-closed), got %v", err)
	}
}

func TestVerifyNafathWebhook_RejectsMissingSignature(t *testing.T) {
	secret := "whsec"
	body := []byte(`{"status":"COMPLETED"}`)
	if _, err := VerifyNafathWebhook(secret, body, "", NafathLoANumberMatch, time.Now()); err != ErrNafathWebhookSignature {
		t.Fatalf("missing signature must be rejected, got %v", err)
	}
}

// A signature-valid callback that is verified but at a WEAK assurance is NOT a
// valid e-sign basis (status preserved, basis denied) — fail-closed.
func TestVerifyNafathWebhook_VerifiedButWeakLoA_NotBasis(t *testing.T) {
	secret := "whsec"
	body := []byte(`{"transId":"T-1","status":"COMPLETED","acr":"otp"}`)
	ev, err := VerifyNafathWebhook(secret, body, sign(secret, body), NafathLoANumberMatch, time.Now())
	if err != nil {
		t.Fatalf("valid signature must verify, got %v", err)
	}
	if ev.Status != NafathStatusVerified {
		t.Fatalf("status should be verified")
	}
	if ev.ValidEsignBasis || ev.LoASatisfied {
		t.Errorf("weak LoA must NOT be a valid e-sign basis: %+v", ev)
	}
}

// Webhook minimum is clamped to the floor even if a caller passes a weaker one.
func TestVerifyNafathWebhook_MinLoAClampedToFloor(t *testing.T) {
	secret := "whsec"
	body := []byte(`{"transId":"T-1","status":"COMPLETED","acr":"app_push"}`)
	ev, _ := VerifyNafathWebhook(secret, body, sign(secret, body), NafathLoASingleFactor, time.Now())
	if ev.MinimumLoA != DefaultNafathMinimumLoA {
		t.Fatalf("expected min clamped to %q, got %q", DefaultNafathMinimumLoA, ev.MinimumLoA)
	}
	if ev.ValidEsignBasis {
		t.Error("app_push is below the number-match floor and must not be a valid basis")
	}
}

// ----------------------------------------------------------------------------
// Sandbox mock (honest, deterministic, end-to-end)
// ----------------------------------------------------------------------------

func TestSandbox_ForcedEndToEnd(t *testing.T) {
	c := newTestConnector()
	c.forceSandbox = true
	ep := model.IntegrationEndpoint{ID: uuid.New(), TenantID: uuid.New(), Status: model.IntegrationStatusActive}

	req, err := c.Invoke(context.Background(), ep, NafathOpRequest, map[string]any{"national_id": "1000000000"})
	if err != nil || !req.Success {
		t.Fatalf("sandbox request: %+v %v", req, err)
	}
	if req.Output["transport"] != "sandbox-mock" {
		t.Errorf("sandbox result must be labelled mock, got %v", req.Output["transport"])
	}
	transID, _ := req.Output["trans_id"].(string)

	st, err := c.Invoke(context.Background(), ep, NafathOpStatus, map[string]any{"trans_id": transID})
	if err != nil {
		t.Fatalf("sandbox status: %v", err)
	}
	if st.Output["status"] != string(NafathStatusVerified) {
		t.Errorf("sandbox status should resolve verified, got %v", st.Output["status"])
	}
}

func TestSandboxInvoke_DeterministicCycle(t *testing.T) {
	c := newTestConnector()
	ep := model.IntegrationEndpoint{ID: uuid.New(), TenantID: uuid.New(), Status: model.IntegrationStatusActive}

	// request is deterministic across runs.
	r1, _ := c.SandboxInvoke(context.Background(), ep, NafathOpRequest, map[string]any{"national_id": "1000000000"})
	r2, _ := c.SandboxInvoke(context.Background(), ep, NafathOpRequest, map[string]any{"national_id": "1000000000"})
	if r1.Reference != r2.Reference {
		t.Errorf("sandbox request must be deterministic: %q vs %q", r1.Reference, r2.Reference)
	}
	if r1.Output["sandbox"] != true {
		t.Error("SandboxInvoke must mark sandbox=true")
	}

	// poll 0 -> pending, poll 1 -> verified.
	p0, _ := c.SandboxInvoke(context.Background(), ep, NafathOpStatus, map[string]any{"trans_id": r1.Reference})
	if p0.Output["status"] != string(NafathStatusPending) {
		t.Errorf("first poll should be pending, got %v", p0.Output["status"])
	}
	p1, _ := c.SandboxInvoke(context.Background(), ep, NafathOpStatus, map[string]any{"trans_id": r1.Reference, "attempt": float64(1)})
	if p1.Output["status"] != string(NafathStatusVerified) {
		t.Errorf("later poll should be verified, got %v", p1.Output["status"])
	}
}

func TestSandboxInvoke_NeverCallsLiveAndUnsupportedOp(t *testing.T) {
	c := newTestConnector()
	ep := model.IntegrationEndpoint{ID: uuid.New(), Status: model.IntegrationStatusActive}
	_, err := c.SandboxInvoke(context.Background(), ep, "frobnicate", nil)
	if err == nil {
		t.Fatal("expected unsupported sandbox op error")
	}
}

// ----------------------------------------------------------------------------
// LoA mapping + comparison unit coverage
// ----------------------------------------------------------------------------

func TestMapNafathLoA(t *testing.T) {
	cases := map[string]NafathLoA{
		"number-match":               NafathLoANumberMatch,
		"number_match":               NafathLoANumberMatch,
		"urn:nafath:acr:numbermatch": NafathLoANumberMatch,
		"biometric":                  NafathLoABiometric,
		"face":                       NafathLoABiometric,
		"app-push":                   NafathLoAAppPush,
		"otp":                        NafathLoASingleFactor,
		"password":                   NafathLoASingleFactor,
		"":                           NafathLoANone,
		"wat-is-this":                NafathLoANone,
	}
	for raw, want := range cases {
		if got := MapNafathLoA(raw); got != want {
			t.Errorf("MapNafathLoA(%q)=%q want %q", raw, got, want)
		}
	}
}

func TestMeetsMinimum_FailClosed(t *testing.T) {
	if NafathLoANone.MeetsMinimum(NafathLoANumberMatch) {
		t.Error("none must NOT meet a positive minimum")
	}
	if NafathLoAAppPush.MeetsMinimum(NafathLoANumberMatch) {
		t.Error("app_push is below number_match")
	}
	if !NafathLoANumberMatch.MeetsMinimum(NafathLoANumberMatch) {
		t.Error("number_match meets number_match")
	}
	if !NafathLoABiometric.MeetsMinimum(NafathLoANumberMatch) {
		t.Error("biometric exceeds number_match")
	}
}

func TestEnforceNafathLoA_NonVerifiedIsNotAFailure(t *testing.T) {
	if err := EnforceNafathLoA(NafathStatusPending, NafathLoANone, NafathLoANumberMatch); err != nil {
		t.Errorf("pending is not a LoA failure: %v", err)
	}
	if err := EnforceNafathLoA(NafathStatusVerified, NafathLoANumberMatch, NafathLoANumberMatch); err != nil {
		t.Errorf("verified at min should pass: %v", err)
	}
	if err := EnforceNafathLoA(NafathStatusVerified, NafathLoAAppPush, NafathLoANumberMatch); err == nil {
		t.Error("verified below min must fail closed")
	}
}

func TestWebhookSecretFor_And_MinimumLoAFor(t *testing.T) {
	ep := model.IntegrationEndpoint{Config: map[string]any{"webhook_secret": "ws", "minimum_loa": "biometric"}}
	if WebhookSecretFor(ep) != "ws" {
		t.Error("WebhookSecretFor should resolve plaintext secret")
	}
	if MinimumLoAFor(ep) != NafathLoABiometric {
		t.Errorf("MinimumLoAFor should resolve biometric, got %q", MinimumLoAFor(ep))
	}
}
