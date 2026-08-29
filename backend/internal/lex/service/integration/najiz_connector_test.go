package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// newTestNajizConnector builds a Najiz connector with a short timeout, suitable for
// httptest servers (production round-trip) and the in-process sandbox/unconfigured
// paths (no network).
func newTestNajizConnector() *NajizConnector {
	return NewNajizConnector(NajizConnectorConfig{
		Logger:  zerolog.Nop(),
		Timeout: 3 * time.Second,
	})
}

// najizEndpoint constructs an endpoint with the given config and an Active status
// (the default for sandbox/production assertions). tenant_id is FIRST in the model.
func najizEndpoint(cfg map[string]any) model.IntegrationEndpoint {
	return model.IntegrationEndpoint{
		ID:       uuid.New(),
		TenantID: uuid.New(),
		Kind:     model.IntegrationKindNajiz,
		Code:     "najiz-test",
		Status:   model.IntegrationStatusActive,
		Config:   cfg,
	}
}

// ----------------------------------------------------------------------------
// Mode 1 — UNCONFIGURED: ErrNajizNotConfigured, honest manual fallback.
// ----------------------------------------------------------------------------

// An endpoint with no usable config resolves to manual fallback: Probe reports
// not_configured (never reachable), TestConnection is an honest miss (no faked
// pass), and Sync returns ErrNajizNotConfigured with zero processed rows.
func TestNajizUnconfigured_ManualFallback(t *testing.T) {
	c := newTestNajizConnector()
	ep := najizEndpoint(map[string]any{}) // no base_url/token_url/client_id

	h := c.Probe(context.Background(), ep, time.Now())
	if h.Reachable {
		t.Error("unconfigured najiz must NOT be reachable")
	}
	if !strings.Contains(strings.ToLower(h.Detail), "not_configured") {
		t.Errorf("expected not_configured grade, got %q", h.Detail)
	}

	res, err := c.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	if res.Reachable {
		t.Fatal("unconfigured TestConnection must never report reachable=true")
	}
	if !strings.Contains(strings.ToLower(res.Detail), "not_configured") {
		t.Errorf("expected not_configured detail, got %q", res.Detail)
	}

	report, serr := c.Sync(context.Background(), ep, SyncModeFull)
	if serr != ErrNajizNotConfigured {
		t.Fatalf("expected ErrNajizNotConfigured, got %v", serr)
	}
	if report.Processed != 0 || report.Created != 0 {
		t.Errorf("manual fallback must process zero rows, got %+v", report)
	}
}

// Partial production config (base_url present but token_url/client_id absent) is
// STILL unconfigured — it stays in manual fallback rather than half-activating.
func TestNajizPartialConfig_StaysUnconfigured(t *testing.T) {
	c := newTestNajizConnector()
	ep := najizEndpoint(map[string]any{"base_url": "https://takamul.example"})

	if _, err := c.Sync(context.Background(), ep, SyncModeDelta); err != ErrNajizNotConfigured {
		t.Fatalf("partial config must stay unconfigured, got %v", err)
	}
	h := c.Probe(context.Background(), ep, time.Now())
	if h.Reachable {
		t.Error("partial-config najiz must not be reachable")
	}
}

// Invoke (add_representative) is also honest under manual fallback: it returns
// ErrNajizNotConfigured and keeps the representative as a manual entry.
func TestNajizUnconfigured_InvokeKeepsManual(t *testing.T) {
	c := newTestNajizConnector()
	ep := najizEndpoint(map[string]any{})
	out, err := c.Invoke(context.Background(), ep, najizOpAddRepresentative, map[string]any{"name": "Rep"})
	if err != ErrNajizNotConfigured {
		t.Fatalf("expected ErrNajizNotConfigured, got %v", err)
	}
	if out.Success {
		t.Error("manual fallback must not claim success")
	}
	if out.Output["najiz_status"] != string(model.NajizSyncStatusManual) {
		t.Errorf("expected najiz_status=manual, got %v", out.Output["najiz_status"])
	}
}

// ----------------------------------------------------------------------------
// Mode 2 — SANDBOX: deterministic mock rows, health graded sandbox (never
// production-healthy), no live MoJ access.
// ----------------------------------------------------------------------------

// Sandbox mode (environment=sandbox) yields deterministic mock hearing rows and a
// reachable-but-sandbox-labelled health/test result — never a faked production pass.
func TestNajizSandbox_DeterministicHearingsAndHonestHealth(t *testing.T) {
	c := newTestNajizConnector()
	ep := najizEndpoint(map[string]any{
		"environment": "sandbox",
		"court_id":    "RUH-COM",
	})

	// Probe: reachable but explicitly labelled sandbox / not production-graded.
	h := c.Probe(context.Background(), ep, time.Now())
	if !h.Reachable {
		t.Fatal("sandbox must grade reachable=true (mock transport up)")
	}
	low := strings.ToLower(h.Detail)
	if !strings.Contains(low, "sandbox") || !strings.Contains(low, "not production-graded") {
		t.Errorf("sandbox health must be clearly labelled non-production, got %q", h.Detail)
	}

	// TestConnection: sandbox OK, explicitly not a live MoJ Takamul connection.
	res, err := c.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	if !res.Reachable {
		t.Error("sandbox TestConnection should report reachable=true (mock token)")
	}
	if res.Metadata["mode"] != string(najizModeSandbox) {
		t.Errorf("expected mode=sandbox in metadata, got %v", res.Metadata["mode"])
	}
	if !strings.Contains(res.Detail, "not a live") {
		t.Errorf("sandbox test must disclaim a live connection, got %q", res.Detail)
	}

	// Sync (default op pull_hearings): deterministic rows, all labelled sandbox.
	report, serr := c.Sync(context.Background(), ep, SyncModeFull)
	if serr != nil {
		t.Fatalf("sandbox sync must not error, got %v", serr)
	}
	if report.Metadata["mode"] != string(najizModeSandbox) {
		t.Errorf("sandbox report must carry mode=sandbox, got %v", report.Metadata["mode"])
	}
	if report.Metadata["operation"] != najizSyncPullHearings {
		t.Errorf("default sync op must be pull_hearings, got %v", report.Metadata["operation"])
	}
	rows, ok := report.Metadata["sample"].([]map[string]any)
	if !ok || len(rows) == 0 {
		t.Fatalf("expected non-empty sandbox sample rows, got %v", report.Metadata["sample"])
	}
	if report.Processed != len(rows) || report.Created != len(rows) {
		t.Errorf("counts must match the sample size, got processed=%d created=%d rows=%d", report.Processed, report.Created, len(rows))
	}
	for _, r := range rows {
		if r["sandbox"] != true {
			t.Errorf("every sandbox hearing row must be labelled sandbox=true, got %v", r)
		}
		if _, has := r["najiz_reference"]; !has {
			t.Errorf("sandbox hearing must carry a najiz_reference, got %v", r)
		}
		if _, has := r["hearing_at"]; !has {
			t.Errorf("sandbox hearing must carry hearing_at (calendar feed), got %v", r)
		}
	}

	// Determinism: a second identical sync returns byte-identical references.
	report2, _ := c.Sync(context.Background(), ep, SyncModeFull)
	rows2, _ := report2.Metadata["sample"].([]map[string]any)
	if len(rows) != len(rows2) {
		t.Fatalf("sandbox sync must be deterministic in length: %d vs %d", len(rows), len(rows2))
	}
	for i := range rows {
		if rows[i]["najiz_reference"] != rows2[i]["najiz_reference"] {
			t.Errorf("sandbox references must be deterministic: %v vs %v", rows[i]["najiz_reference"], rows2[i]["najiz_reference"])
		}
	}
}

// The `najiz-sandbox:` base_url sentinel also selects sandbox mode (an operator can
// flag sandbox via the URL without a separate environment field).
func TestNajizSandbox_BaseURLSentinel(t *testing.T) {
	c := newTestNajizConnector()
	ep := najizEndpoint(map[string]any{"base_url": "najiz-sandbox://mock"})
	report, err := c.Sync(context.Background(), ep, SyncModeFull)
	if err != nil {
		t.Fatalf("sentinel sandbox sync must not error, got %v", err)
	}
	if report.Metadata["mode"] != string(najizModeSandbox) {
		t.Errorf("najiz-sandbox: sentinel must select sandbox mode, got %v", report.Metadata["mode"])
	}
}

// Every non-default sync op returns deterministic, sandbox-labelled rows too, so the
// console/E2E can exercise each read without live MoJ access.
func TestNajizSandbox_AllSyncOpsReturnRows(t *testing.T) {
	c := newTestNajizConnector()
	for _, op := range []string{najizSyncPullHearings, najizSyncGetCase, najizSyncListJudgments, najizSyncEnforcementCase} {
		ep := najizEndpoint(map[string]any{"environment": "sandbox", "sync_operation": op})
		report, err := c.Sync(context.Background(), ep, SyncModeFull)
		if err != nil {
			t.Fatalf("op %s: sandbox sync errored: %v", op, err)
		}
		if report.Processed == 0 {
			t.Errorf("op %s: expected at least one sandbox row", op)
		}
		if report.Metadata["operation"] != op {
			t.Errorf("op %s: report operation mismatch, got %v", op, report.Metadata["operation"])
		}
	}
}

// SandboxInvoke (the console "try it" path) runs the mock transport REGARDLESS of
// config and always labels its output sandbox=true — the health grade is unchanged.
func TestNajizSandboxInvoke_PullHearings_AlwaysMock(t *testing.T) {
	c := newTestNajizConnector()
	// Even a (would-be) production config is exercised in mock mode by SandboxInvoke.
	ep := najizEndpoint(map[string]any{
		"environment":   "production",
		"base_url":      "https://takamul.example",
		"token_url":     "https://takamul.example/oauth/token",
		"client_id":     "cid",
		"client_secret": "shhh-SECRET",
	})
	out, err := c.SandboxInvoke(context.Background(), ep, najizSyncPullHearings, nil)
	if err != nil {
		t.Fatalf("SandboxInvoke: %v", err)
	}
	if !out.Success || out.Output["sandbox"] != true {
		t.Fatalf("SandboxInvoke must succeed and mark sandbox=true, got %+v", out)
	}
	hearings, ok := out.Output["hearings"].([]map[string]any)
	if !ok || len(hearings) == 0 {
		t.Fatalf("expected mock hearings in SandboxInvoke output, got %v", out.Output["hearings"])
	}
	if strings.Contains(strings.ToLower(out.Detail), "live") && !strings.Contains(strings.ToLower(out.Detail), "no live") {
		t.Errorf("sandbox invoke must not claim a live connection, got %q", out.Detail)
	}
}

// issue_wakala is HARD-GATED on a Nafath-confirmed identity even in sandbox: with no
// nafath_reference it refuses (pending-Nafath) rather than fabricating a DoA.
func TestNajizSandbox_IssueWakalaPendingNafath(t *testing.T) {
	c := newTestNajizConnector()
	ep := najizEndpoint(map[string]any{"environment": "sandbox"})
	out, err := c.Invoke(context.Background(), ep, najizOpIssueWakala, map[string]any{})
	if err != ErrNajizWakalaPendingNafath {
		t.Fatalf("expected ErrNajizWakalaPendingNafath, got %v", err)
	}
	if out.Success {
		t.Error("wakala must not issue without a Nafath-confirmed identity")
	}
	// With a Nafath reference, the sandbox issues a mock wakala.
	out, err = c.Invoke(context.Background(), ep, najizOpIssueWakala, map[string]any{"nafath_reference": "NAF-OK-1"})
	if err != nil {
		t.Fatalf("sandbox wakala with nafath ref: %v", err)
	}
	if !out.Success || out.Output["mode"] != string(najizModeSandbox) {
		t.Errorf("expected sandbox wakala success, got %+v", out)
	}
}

// ----------------------------------------------------------------------------
// Mode 3 — PRODUCTION: real OAuth client-credentials round-trip + read.
// ----------------------------------------------------------------------------

// A full production endpoint mints a client-credentials token then GETs the
// configurable hearings path, returning fetched rows. Both the token and read
// servers are httptest stand-ins for the gov-gated Takamul portal.
func TestNajizProduction_PullHearingsRoundTrip(t *testing.T) {
	// Token endpoint (OAuth2 client-credentials).
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "prod-token-123", "expires_in": 3600})
	}))
	defer tokenSrv.Close()

	// Resource endpoint (the hearings read).
	var sawAuth string
	resourceSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuth = r.Header.Get("Authorization")
		if !strings.HasSuffix(r.URL.Path, "/hearings") {
			t.Errorf("unexpected resource path %q (must come from config, not hardcoded)", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"hearings": []any{
				map[string]any{"najiz_reference": "HRG-9001", "hearing_at": "2026-08-01T09:00:00+03:00"},
			},
			"watermark": "wm-42",
		})
	}))
	defer resourceSrv.Close()

	c := newTestNajizConnector()
	ep := najizEndpoint(map[string]any{
		"environment":   "production",
		"base_url":      resourceSrv.URL,
		"token_url":     tokenSrv.URL,
		"client_id":     "cid",
		"client_secret": "shhh-SECRET",
	})

	report, err := c.Sync(context.Background(), ep, SyncModeFull)
	if err != nil {
		t.Fatalf("production sync: %v", err)
	}
	if report.Processed != 1 || report.Created != 1 {
		t.Errorf("expected 1 fetched hearing, got %+v", report)
	}
	if report.Metadata["mode"] != string(najizModeProduction) {
		t.Errorf("expected mode=production, got %v", report.Metadata["mode"])
	}
	if report.Watermark != "wm-42" {
		t.Errorf("expected upstream watermark to ride through, got %q", report.Watermark)
	}
	if sawAuth != "Bearer prod-token-123" {
		t.Errorf("resource call must carry the bearer token, got %q", sawAuth)
	}
}

// Production TestConnection mints a token round-trip (no writes) and reports a
// configured-but-secret-free pass.
func TestNajizProduction_TestConnectionTokenRoundTrip(t *testing.T) {
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "tok-xyz", "expires_in": 3600})
	}))
	defer tokenSrv.Close()

	c := newTestNajizConnector()
	ep := najizEndpoint(map[string]any{
		"environment":   "production",
		"base_url":      "https://takamul.example",
		"token_url":     tokenSrv.URL,
		"client_id":     "cid",
		"client_secret": "shhh-SECRET",
	})
	res, err := c.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	if !res.Reachable {
		t.Errorf("a successful token round-trip must grade reachable, got %q", res.Detail)
	}
	if res.Metadata["mode"] != string(najizModeProduction) {
		t.Errorf("expected mode=production, got %v", res.Metadata["mode"])
	}
	// The secret must never leak into the sanitized result.
	blob, _ := json.Marshal(res)
	if strings.Contains(string(blob), "SECRET") {
		t.Errorf("client_secret leaked into TestResult: %s", blob)
	}
}

// A failing token endpoint must surface an honest, secret-free not-reachable result
// (never a faked pass).
func TestNajizProduction_TokenFailure_HonestMiss(t *testing.T) {
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"invalid_client SECRET-trace"}`, http.StatusUnauthorized)
	}))
	defer tokenSrv.Close()

	c := newTestNajizConnector()
	ep := najizEndpoint(map[string]any{
		"environment":   "production",
		"base_url":      "https://takamul.example",
		"token_url":     tokenSrv.URL,
		"client_id":     "cid",
		"client_secret": "shhh-SECRET",
	})
	res, err := c.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("TestConnection should not hard-error on auth failure: %v", err)
	}
	if res.Reachable {
		t.Error("a token failure must not be graded reachable")
	}
}

// ----------------------------------------------------------------------------
// Lifecycle + config invariants
// ----------------------------------------------------------------------------

// A disabled endpoint reports its lifecycle state regardless of config (even a full
// production config is held back behind the disabled flag).
func TestNajizProbe_DisabledOverridesConfig(t *testing.T) {
	c := newTestNajizConnector()
	ep := najizEndpoint(map[string]any{
		"environment":   "production",
		"base_url":      "https://takamul.example",
		"token_url":     "https://takamul.example/oauth/token",
		"client_id":     "cid",
		"client_secret": "shhh-SECRET",
	})
	ep.Status = model.IntegrationStatusDisabled
	h := c.Probe(context.Background(), ep, time.Now())
	if h.Reachable {
		t.Error("disabled endpoint must not be reachable")
	}
	if !strings.Contains(h.Detail, "disabled") {
		t.Errorf("expected disabled detail, got %q", h.Detail)
	}
}

// Kind is stable.
func TestNajizKind(t *testing.T) {
	if newTestNajizConnector().Kind() != model.IntegrationKindNajiz {
		t.Errorf("Kind must be najiz")
	}
}

// NO HARDCODED GOV ENDPOINT PATHS: every default path is a RELATIVE shape (no host),
// and the resolved paths are driven entirely by config keys. This guards D3 — go-live
// is creds-only, with no code change to a baked-in MoJ host.
func TestNajiz_NoHardcodedGovHostPaths(t *testing.T) {
	cfg := parseNajizConnectorConfig(map[string]any{})
	defaults := map[string]string{
		"add_representative": cfg.AddRepresentativePath,
		"wakala":             cfg.WakalaPath,
		"hearings":           cfg.HearingsPath,
		"case":               cfg.CasePath,
		"judgments":          cfg.JudgmentsPath,
		"enforcement":        cfg.EnforcementPath,
	}
	for name, p := range defaults {
		if !strings.HasPrefix(p, "/") {
			t.Errorf("%s default path must be a relative shape, got %q", name, p)
		}
		// A relative shape must NOT embed a scheme/host (no baked gov endpoint).
		if strings.Contains(p, "://") || strings.Contains(strings.TrimPrefix(p, "/"), ".") {
			t.Errorf("%s default path must not embed a host, got %q", name, p)
		}
	}

	// Operator-supplied paths fully override the defaults (config-driven dispatch).
	cfg = parseNajizConnectorConfig(map[string]any{
		"hearings_path":           "/v2/court/hearings",
		"add_representative_path": "/v2/agencies",
	})
	if cfg.HearingsPath != "/v2/court/hearings" {
		t.Errorf("hearings_path must come from config, got %q", cfg.HearingsPath)
	}
	if got, ok := cfg.syncPath(najizSyncPullHearings); !ok || got != "/v2/court/hearings" {
		t.Errorf("syncPath(pull_hearings) must resolve the configured path, got %q ok=%v", got, ok)
	}
	if cfg.AddRepresentativePath != "/v2/agencies" {
		t.Errorf("add_representative_path must come from config, got %q", cfg.AddRepresentativePath)
	}
}

// An unsupported sync op is rejected (config-driven dispatch has a closed set).
func TestNajiz_UnsupportedSyncPath(t *testing.T) {
	cfg := parseNajizConnectorConfig(map[string]any{})
	if _, ok := cfg.syncPath("frobnicate"); ok {
		t.Error("unknown sync op must not resolve a path")
	}
}
