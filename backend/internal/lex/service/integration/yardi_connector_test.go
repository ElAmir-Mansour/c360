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

// newTestYardiConnector builds a Yardi connector with a short timeout, suitable for
// httptest servers (production round-trip) and the in-process sandbox/unconfigured
// paths (no network).
func newTestYardiConnector() *YardiConnector {
	return NewYardiConnector(YardiConnectorConfig{
		Logger:  zerolog.Nop(),
		Timeout: 3 * time.Second,
	})
}

// yardiEndpoint constructs an Active endpoint with the given config. tenant_id is
// FIRST in the model.
func yardiEndpoint(cfg map[string]any) model.IntegrationEndpoint {
	return model.IntegrationEndpoint{
		ID:       uuid.New(),
		TenantID: uuid.New(),
		Kind:     model.IntegrationKindYardi,
		Code:     "yardi-test",
		Status:   model.IntegrationStatusActive,
		Config:   cfg,
	}
}

// ----------------------------------------------------------------------------
// Kind + schema/catalog registration.
// ----------------------------------------------------------------------------

func TestYardiKind(t *testing.T) {
	if newTestYardiConnector().Kind() != model.IntegrationKindYardi {
		t.Errorf("Kind must be yardi")
	}
}

// The kind is fully registered: it has a config schema and a self-serve catalog card.
func TestYardiSchemaAndCatalogRegistered(t *testing.T) {
	schema, ok := SchemaFor(model.IntegrationKindYardi)
	if !ok {
		t.Fatal("SchemaFor(yardi) must be registered")
	}
	if _, has := schema.FieldByKey("base_url"); !has {
		t.Error("yardi schema must expose base_url")
	}
	// The shared reliability/governance/observability fields are auto-appended.
	if _, has := schema.FieldByKey(SLOTargetPctKey); !has {
		t.Error("yardi schema must inherit the shared SLO field via init()")
	}
	// The scheduled-sync cadence field must be present for the sync monitor.
	if _, has := schema.FieldByKey(SyncIntervalMinutesKey); !has {
		t.Error("yardi schema must expose the sync interval field")
	}
	entry, ok := CatalogFor(model.IntegrationKindYardi)
	if !ok {
		t.Fatal("CatalogFor(yardi) must be registered")
	}
	if !entry.SelfServe {
		t.Error("yardi must be self-serve")
	}
	if entry.Maturity != MaturityProduction {
		t.Errorf("yardi maturity must be production, got %q", entry.Maturity)
	}
}

// ----------------------------------------------------------------------------
// Mode 1 — UNCONFIGURED: ErrYardiNotConfigured, honest not-onboarded affordance.
// ----------------------------------------------------------------------------

func TestYardiUnconfigured_NotOnboarded(t *testing.T) {
	c := newTestYardiConnector()
	ep := yardiEndpoint(map[string]any{})

	h := c.Probe(context.Background(), ep, time.Now())
	if h.Reachable {
		t.Error("unconfigured yardi must NOT be reachable")
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

	report, serr := c.Sync(context.Background(), ep, SyncModeFull)
	if serr != ErrYardiNotConfigured {
		t.Fatalf("expected ErrYardiNotConfigured, got %v", serr)
	}
	if report.Processed != 0 || report.Created != 0 {
		t.Errorf("not-onboarded sync must process zero rows, got %+v", report)
	}
}

// Partial production config (base_url present but the auth set incomplete) stays
// unconfigured rather than half-activating.
func TestYardiPartialConfig_StaysUnconfigured(t *testing.T) {
	c := newTestYardiConnector()
	ep := yardiEndpoint(map[string]any{"base_url": "https://voyager.example", "auth_type": "oauth2_cc"})
	if _, err := c.Sync(context.Background(), ep, SyncModeDelta); err != ErrYardiNotConfigured {
		t.Fatalf("partial config must stay unconfigured, got %v", err)
	}
	if c.Probe(context.Background(), ep, time.Now()).Reachable {
		t.Error("partial-config yardi must not be reachable")
	}
}

// ----------------------------------------------------------------------------
// Mode 2 — SANDBOX: deterministic mock rows, health graded sandbox (never
// production-healthy), no live Yardi access.
// ----------------------------------------------------------------------------

func TestYardiSandbox_DeterministicLeasesAndHonestHealth(t *testing.T) {
	c := newTestYardiConnector()
	ep := yardiEndpoint(map[string]any{"environment": "sandbox", "record_scope": "leases"})

	h := c.Probe(context.Background(), ep, time.Now())
	if !h.Reachable {
		t.Fatal("sandbox must grade reachable=true (mock transport up)")
	}
	low := strings.ToLower(h.Detail)
	if !strings.Contains(low, "sandbox") || !strings.Contains(low, "not production-graded") {
		t.Errorf("sandbox health must be clearly labelled non-production, got %q", h.Detail)
	}

	res, err := c.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	if !res.Reachable || res.Metadata["mode"] != string(yardiModeSandbox) {
		t.Errorf("sandbox test must be reachable + labelled sandbox, got %+v", res)
	}
	if !strings.Contains(res.Detail, "not a live") {
		t.Errorf("sandbox test must disclaim a live connection, got %q", res.Detail)
	}

	report, serr := c.Sync(context.Background(), ep, SyncModeFull)
	if serr != nil {
		t.Fatalf("sandbox sync must not error, got %v", serr)
	}
	rows, ok := report.Metadata["sample"].([]map[string]any)
	if !ok || len(rows) == 0 {
		t.Fatalf("expected non-empty sandbox sample rows, got %v", report.Metadata["sample"])
	}
	if report.Processed != len(rows) || report.Created != len(rows) {
		t.Errorf("counts must match sample size, got processed=%d created=%d rows=%d", report.Processed, report.Created, len(rows))
	}
	for _, r := range rows {
		if r["sandbox"] != true {
			t.Errorf("every sandbox row must be labelled sandbox=true, got %v", r)
		}
		if _, has := r["lease_id"]; !has {
			t.Errorf("sandbox lease must carry a lease_id, got %v", r)
		}
	}

	// Determinism: a second identical sync returns byte-identical references.
	report2, _ := c.Sync(context.Background(), ep, SyncModeFull)
	rows2, _ := report2.Metadata["sample"].([]map[string]any)
	if len(rows) != len(rows2) {
		t.Fatalf("sandbox sync must be deterministic in length: %d vs %d", len(rows), len(rows2))
	}
	for i := range rows {
		if rows[i]["lease_id"] != rows2[i]["lease_id"] {
			t.Errorf("sandbox lease_ids must be deterministic: %v vs %v", rows[i]["lease_id"], rows2[i]["lease_id"])
		}
	}
}

// record_scope=both pulls leases + properties (more rows than either alone).
func TestYardiSandbox_ScopeBoth(t *testing.T) {
	c := newTestYardiConnector()
	both := yardiEndpoint(map[string]any{"environment": "sandbox", "record_scope": "both"})
	leasesOnly := yardiEndpoint(map[string]any{"environment": "sandbox", "record_scope": "leases"})
	rb, _ := c.Sync(context.Background(), both, SyncModeFull)
	rl, _ := c.Sync(context.Background(), leasesOnly, SyncModeFull)
	if rb.Processed <= rl.Processed {
		t.Errorf("scope=both must pull more than leases alone: both=%d leases=%d", rb.Processed, rl.Processed)
	}
}

// The yardi-sandbox: base_url sentinel also selects sandbox mode.
func TestYardiSandbox_BaseURLSentinel(t *testing.T) {
	c := newTestYardiConnector()
	ep := yardiEndpoint(map[string]any{"base_url": "yardi-sandbox://mock"})
	report, err := c.Sync(context.Background(), ep, SyncModeFull)
	if err != nil {
		t.Fatalf("sentinel sandbox sync must not error, got %v", err)
	}
	if report.Metadata["mode"] != string(yardiModeSandbox) {
		t.Errorf("yardi-sandbox: sentinel must select sandbox mode, got %v", report.Metadata["mode"])
	}
}

// SyncModePreview (dry-run) computes counts but writes nothing (Created==0, DryRun).
func TestYardiSandbox_PreviewWritesNothing(t *testing.T) {
	c := newTestYardiConnector()
	ep := yardiEndpoint(map[string]any{"environment": "sandbox", "record_scope": "leases"})
	report, err := c.Sync(context.Background(), ep, SyncModePreview)
	if err != nil {
		t.Fatalf("preview sync must not error, got %v", err)
	}
	if !report.DryRun {
		t.Error("preview must set DryRun=true")
	}
	if report.Processed == 0 {
		t.Error("preview must still report what WOULD sync")
	}
	if report.Created != 0 {
		t.Errorf("preview must write nothing (Created==0), got %d", report.Created)
	}
}

// SandboxInvoke (the console "try it" path) runs the mock transport REGARDLESS of
// config and always labels its output sandbox=true.
func TestYardiSandboxInvoke_AlwaysMock(t *testing.T) {
	c := newTestYardiConnector()
	// Even a (would-be) production config is exercised in mock mode by SandboxInvoke.
	ep := yardiEndpoint(map[string]any{
		"environment":   "production",
		"base_url":      "https://voyager.example",
		"auth_type":     "oauth2_cc",
		"token_url":     "https://voyager.example/oauth/token",
		"client_id":     "cid",
		"client_secret": "shhh-SECRET",
	})
	out, err := c.SandboxInvoke(context.Background(), ep, yardiSyncPullLeases, nil)
	if err != nil {
		t.Fatalf("SandboxInvoke: %v", err)
	}
	if !out.Success || out.Output["sandbox"] != true {
		t.Fatalf("SandboxInvoke must succeed and mark sandbox=true, got %+v", out)
	}
	records, ok := out.Output["records"].([]map[string]any)
	if !ok || len(records) == 0 {
		t.Fatalf("expected mock records in SandboxInvoke output, got %v", out.Output["records"])
	}
	// push_note in sandbox acknowledges without a live write.
	note, err := c.SandboxInvoke(context.Background(), ep, yardiOpPushNote, map[string]any{"lease_id": "L-1", "text": "hello"})
	if err != nil {
		t.Fatalf("SandboxInvoke push_note: %v", err)
	}
	if !note.Success || note.Output["sandbox"] != true || note.Reference == "" {
		t.Errorf("sandbox push_note must ack with sandbox=true + a reference, got %+v", note)
	}
}

// ----------------------------------------------------------------------------
// Mode 3 — PRODUCTION: real OAuth client-credentials round-trip + read/write.
// ----------------------------------------------------------------------------

func TestYardiProduction_OAuthPullRoundTrip(t *testing.T) {
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "prod-token-123", "expires_in": 3600})
	}))
	defer tokenSrv.Close()

	var sawAuth, sawDB string
	resourceSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuth = r.Header.Get("Authorization")
		sawDB = r.Header.Get("X-Yardi-Database")
		if !strings.HasSuffix(strings.SplitN(r.URL.Path, "?", 2)[0], "/leases") {
			t.Errorf("unexpected resource path %q (must come from config)", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"leases":    []any{map[string]any{"lease_id": "L-9001", "rent": 120000}},
			"watermark": "wm-42",
		})
	}))
	defer resourceSrv.Close()

	c := newTestYardiConnector()
	ep := yardiEndpoint(map[string]any{
		"environment":   "production",
		"base_url":      resourceSrv.URL,
		"auth_type":     "oauth2_cc",
		"token_url":     tokenSrv.URL,
		"client_id":     "cid",
		"client_secret": "shhh-SECRET",
		"database":      "othaim_prod",
		"record_scope":  "leases",
	})

	report, err := c.Sync(context.Background(), ep, SyncModeFull)
	if err != nil {
		t.Fatalf("production sync: %v", err)
	}
	if report.Processed != 1 || report.Created != 1 {
		t.Errorf("expected 1 fetched lease, got %+v", report)
	}
	if report.Watermark != "wm-42" {
		t.Errorf("expected upstream watermark to ride through, got %q", report.Watermark)
	}
	if sawAuth != "Bearer prod-token-123" {
		t.Errorf("resource call must carry the bearer token, got %q", sawAuth)
	}
	if sawDB != "othaim_prod" {
		t.Errorf("resource call must carry the Yardi database routing header, got %q", sawDB)
	}
}

// API-key auth uses the static key header — no token endpoint required.
func TestYardiProduction_APIKeyAuth(t *testing.T) {
	var sawKey string
	resourceSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawKey = r.Header.Get("X-Yardi-Api-Key")
		_ = json.NewEncoder(w).Encode(map[string]any{"properties": []any{map[string]any{"property_id": "P-1"}}})
	}))
	defer resourceSrv.Close()

	c := newTestYardiConnector()
	ep := yardiEndpoint(map[string]any{
		"environment":  "production",
		"base_url":     resourceSrv.URL,
		"auth_type":    "api_key",
		"api_key":      "KEY-SECRET",
		"record_scope": "properties",
	})
	report, err := c.Sync(context.Background(), ep, SyncModeFull)
	if err != nil {
		t.Fatalf("api-key sync: %v", err)
	}
	if report.Processed != 1 {
		t.Errorf("expected 1 fetched property, got %+v", report)
	}
	if sawKey != "KEY-SECRET" {
		t.Errorf("api-key auth must send the key header, got %q", sawKey)
	}
}

// TestConnection mints a token round-trip + sample fetch and never leaks the secret.
func TestYardiProduction_TestConnectionNoSecretLeak(t *testing.T) {
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "tok-xyz", "expires_in": 3600})
	}))
	defer tokenSrv.Close()
	resourceSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"leases": []any{map[string]any{"lease_id": "L-1"}}})
	}))
	defer resourceSrv.Close()

	c := newTestYardiConnector()
	ep := yardiEndpoint(map[string]any{
		"environment":   "production",
		"base_url":      resourceSrv.URL,
		"auth_type":     "oauth2_cc",
		"token_url":     tokenSrv.URL,
		"client_id":     "cid",
		"client_secret": "shhh-SECRET",
	})
	res, err := c.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	if !res.Reachable {
		t.Errorf("a successful round-trip must grade reachable, got %q", res.Detail)
	}
	if len(res.Steps) == 0 {
		t.Error("production test must stage diagnostic steps")
	}
	blob, _ := json.Marshal(res)
	if strings.Contains(string(blob), "SECRET") {
		t.Errorf("client_secret leaked into TestResult: %s", blob)
	}
}

// A failing token endpoint surfaces an honest, secret-free not-reachable result.
func TestYardiProduction_TokenFailure_HonestMiss(t *testing.T) {
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"invalid_client"}`, http.StatusUnauthorized)
	}))
	defer tokenSrv.Close()

	c := newTestYardiConnector()
	ep := yardiEndpoint(map[string]any{
		"environment":   "production",
		"base_url":      "https://voyager.example",
		"auth_type":     "oauth2_cc",
		"token_url":     tokenSrv.URL,
		"client_id":     "cid",
		"client_secret": "shhh-CLIENT-SECRET-VALUE",
	})
	res, err := c.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("TestConnection should not hard-error on auth failure: %v", err)
	}
	if res.Reachable {
		t.Error("a token failure must not be graded reachable")
	}
	// The connector's own credential must never leak into the sanitized result.
	blob, _ := json.Marshal(res)
	if strings.Contains(string(blob), "CLIENT-SECRET-VALUE") {
		t.Errorf("client_secret leaked into TestResult: %s", blob)
	}
}

// ----------------------------------------------------------------------------
// Lifecycle + config invariants.
// ----------------------------------------------------------------------------

// A disabled endpoint reports its lifecycle state regardless of config.
func TestYardiProbe_DisabledOverridesConfig(t *testing.T) {
	c := newTestYardiConnector()
	ep := yardiEndpoint(map[string]any{
		"environment":   "production",
		"base_url":      "https://voyager.example",
		"auth_type":     "oauth2_cc",
		"token_url":     "https://voyager.example/oauth/token",
		"client_id":     "cid",
		"client_secret": "shhh-SECRET",
	})
	ep.Status = model.IntegrationStatusDisabled
	h := c.Probe(context.Background(), ep, time.Now())
	if h.Reachable || !strings.Contains(h.Detail, "disabled") {
		t.Errorf("disabled endpoint must not be reachable, got %+v", h)
	}
}

// NO HARDCODED YARDI HOST PATHS: every default path is a RELATIVE shape (no host),
// so go-live is creds-only with no baked-in Yardi endpoint.
func TestYardi_NoHardcodedHostPaths(t *testing.T) {
	cfg := parseYardiConnectorConfig(map[string]any{})
	for name, p := range map[string]string{"lease": cfg.LeaseSyncPath, "property": cfg.PropertySyncPath, "note": cfg.NotePath} {
		if !strings.HasPrefix(p, "/") {
			t.Errorf("%s default path must be a relative shape, got %q", name, p)
		}
		if strings.Contains(p, "://") || strings.Contains(strings.TrimPrefix(p, "/"), ".") {
			t.Errorf("%s default path must not embed a host, got %q", name, p)
		}
	}
	// Operator-supplied paths fully override the defaults.
	cfg = parseYardiConnectorConfig(map[string]any{"lease_sync_path": "/v2/leaseset"})
	if cfg.LeaseSyncPath != "/v2/leaseset" {
		t.Errorf("lease_sync_path must come from config, got %q", cfg.LeaseSyncPath)
	}
}

// An unsupported invoke op is rejected.
func TestYardi_UnsupportedInvokeOp(t *testing.T) {
	c := newTestYardiConnector()
	ep := yardiEndpoint(map[string]any{"environment": "sandbox"})
	if _, err := c.Invoke(context.Background(), ep, "frobnicate", nil); err == nil {
		t.Error("unknown invoke op must be rejected")
	}
}
