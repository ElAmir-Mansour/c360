package adapters

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/clario360/platform/internal/events"
	intmodel "github.com/clario360/platform/internal/integration/model"
	"github.com/clario360/platform/internal/integration/service/jira"
	"github.com/clario360/platform/internal/integration/service/servicenow"
	"github.com/clario360/platform/internal/integration/service/slack"
	"github.com/clario360/platform/internal/integration/service/teams"
	"github.com/clario360/platform/internal/integration/service/webhook"
)

// --- test doubles for the jira/servicenow ClarioClient + TicketLinkStore ----
// These are dependency interfaces the production code already injects; the
// network calls under test (CreateIssue / CreateIncident) still hit a real
// httptest server. The doubles only stand in for the originating-service API and
// the persistence layer, both of which are out of scope for connector parity.

type fakeClario struct {
	entity map[string]any
	mu     sync.Mutex
	calls  []string
}

func (f *fakeClario) FetchEntity(ctx context.Context, token, entityType, entityID string) (map[string]any, error) {
	f.mu.Lock()
	f.calls = append(f.calls, "fetch:"+entityType+":"+entityID+":"+token)
	f.mu.Unlock()
	out := make(map[string]any, len(f.entity))
	for k, v := range f.entity {
		out[k] = v
	}
	return out, nil
}
func (f *fakeClario) MintSystemToken(tenantID string) (string, error) { return "system-token", nil }
func (f *fakeClario) UpdateAlertStatus(ctx context.Context, token, alertID, status string, notes, reason *string) error {
	return nil
}
func (f *fakeClario) AddAlertComment(ctx context.Context, token, alertID, content string, metadata map[string]any) error {
	f.mu.Lock()
	f.calls = append(f.calls, "comment:"+alertID+":"+content)
	f.mu.Unlock()
	return nil
}

type fakeLinkStore struct {
	mu      sync.Mutex
	created []*intmodel.ExternalTicketLink
	seq     int
}

func (s *fakeLinkStore) Create(ctx context.Context, link *intmodel.ExternalTicketLink) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	cp := *link
	s.created = append(s.created, &cp)
	return "link-id", nil
}
func (s *fakeLinkStore) GetByExternal(ctx context.Context, externalSystem, externalID string) (*intmodel.ExternalTicketLink, error) {
	return nil, errors.New("not found")
}
func (s *fakeLinkStore) UpdateSync(ctx context.Context, link *intmodel.ExternalTicketLink) error {
	return nil
}

func (s *fakeLinkStore) last() *intmodel.ExternalTicketLink {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.created) == 0 {
		return nil
	}
	return s.created[len(s.created)-1]
}

func testEvent(t *testing.T, typ string, data map[string]any) *events.Event {
	t.Helper()
	evt, err := events.NewEvent(typ, "notification-service", "tenant-1", data)
	if err != nil {
		t.Fatalf("build event: %v", err)
	}
	return evt
}

func testIntegration(typ intmodel.IntegrationType) *intmodel.Integration {
	return &intmodel.Integration{
		ID:       "integration-1",
		TenantID: "tenant-1",
		Type:     typ,
		Name:     "test",
		Status:   intmodel.IntegrationStatusActive,
	}
}

// ===========================================================================
// PARITY: SLACK — legacy client.Send vs registry dispatch produce identical
// HTTP call/payload/response. Driven through the incoming_webhook_url path so a
// real httptest server can capture the request (chat.postMessage hits the
// hardcoded slack.com host and is exercised separately via Test-path parity for
// the error contract).
// ===========================================================================

func TestParity_Slack_Send(t *testing.T) {
	type capture struct {
		body []byte
		ct   string
	}
	captured := make([]capture, 0, 2)
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		captured = append(captured, capture{body: body, ct: r.Header.Get("Content-Type")})
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()

	client := slack.NewClient(5*time.Second, "https://app.clario.dev")
	cfg := intmodel.SlackConfig{IncomingWebhookURL: srv.URL}
	cfgMap := map[string]any{"incoming_webhook_url": srv.URL, "bot_token": "xoxb-test"}
	evt := testEvent(t, "cyber.alert.created", map[string]any{"title": "Brute force", "severity": "high"})

	// OLD path.
	oldCode, oldBody, oldErr := client.Send(context.Background(), cfg, evt)

	// NEW path through the registry.
	r := BuildDefaultRegistry(Clients{Slack: client})
	res, newErr := r.Send(context.Background(), string(intmodel.IntegrationTypeSlack), cfgMap, evt)

	if oldCode != res.ResponseCode || oldBody != res.ResponseBody {
		t.Fatalf("slack parity mismatch: old=(%d,%q) new=(%d,%q)", oldCode, oldBody, res.ResponseCode, res.ResponseBody)
	}
	if (oldErr == nil) != (newErr == nil) {
		t.Fatalf("slack error parity: old=%v new=%v", oldErr, newErr)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(captured) != 2 {
		t.Fatalf("expected 2 captured requests, got %d", len(captured))
	}
	if string(captured[0].body) != string(captured[1].body) {
		t.Fatalf("slack payload diverged:\n old: %s\n new: %s", captured[0].body, captured[1].body)
	}
	if captured[1].ct != "application/json" {
		t.Errorf("slack content-type = %q", captured[1].ct)
	}
	// Sanity: payload actually carries the alert title.
	if !strings.Contains(string(captured[1].body), "Brute force") {
		t.Errorf("slack payload missing title: %s", captured[1].body)
	}
}

// ===========================================================================
// PARITY: WEBHOOK — legacy client.Post vs registry dispatch.
// ===========================================================================

func TestParity_Webhook_Send(t *testing.T) {
	type capture struct {
		body    []byte
		method  string
		headers http.Header
	}
	var mu sync.Mutex
	captured := make([]capture, 0, 2)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		captured = append(captured, capture{body: body, method: r.Method, headers: r.Header.Clone()})
		mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"ack":true}`))
	}))
	defer srv.Close()

	client := webhook.NewClient(5 * time.Second)
	cfg := intmodel.WebhookConfig{URL: srv.URL, Method: "POST", Secret: "s3cr3t", ContentType: "application/json", Headers: map[string]string{"X-Custom": "v1"}}
	cfgMap := map[string]any{
		"url":          srv.URL,
		"method":       "POST",
		"secret":       "s3cr3t",
		"content_type": "application/json",
		"headers":      map[string]string{"X-Custom": "v1"},
	}
	evt := testEvent(t, "data.pipeline.failed", map[string]any{"id": "pipe-1", "status": "failed"})

	oldCode, oldBody, oldErr := client.Post(context.Background(), cfg, evt)

	r := BuildDefaultRegistry(Clients{Webhook: client})
	res, newErr := r.Send(context.Background(), string(intmodel.IntegrationTypeWebhook), cfgMap, evt)

	if oldCode != res.ResponseCode || oldBody != res.ResponseBody {
		t.Fatalf("webhook parity mismatch: old=(%d,%q) new=(%d,%q)", oldCode, oldBody, res.ResponseCode, res.ResponseBody)
	}
	if (oldErr == nil) != (newErr == nil) {
		t.Fatalf("webhook error parity: old=%v new=%v", oldErr, newErr)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(captured) != 2 {
		t.Fatalf("expected 2 captured requests, got %d", len(captured))
	}
	// Same event => byte-identical JSON body (the event payload is deterministic).
	if string(captured[0].body) != string(captured[1].body) {
		t.Fatalf("webhook payload diverged:\n old: %s\n new: %s", captured[0].body, captured[1].body)
	}
	if captured[1].method != http.MethodPost {
		t.Errorf("webhook method = %q", captured[1].method)
	}
	if got := captured[1].headers.Get("X-Custom"); got != "v1" {
		t.Errorf("custom header not forwarded on new path: %q", got)
	}
	// HMAC signature headers must be present on the new path (real signer ran).
	if captured[1].headers.Get("X-Clario-Signature") == "" && captured[1].headers.Get("X-Signature") == "" {
		// Discover the actual signature header from the old path to avoid coupling
		// to a specific name; both paths must agree on which headers were signed.
		signedHeader := ""
		for k := range captured[0].headers {
			if strings.Contains(strings.ToLower(k), "signature") {
				signedHeader = k
				break
			}
		}
		if signedHeader == "" {
			t.Errorf("no signature header found on either path; headers=%v", captured[1].headers)
		} else if captured[0].headers.Get(signedHeader) == "" || captured[1].headers.Get(signedHeader) == "" {
			t.Errorf("signature header %q not present on both paths", signedHeader)
		}
	}
	if !strings.Contains(string(captured[1].body), "pipe-1") {
		t.Errorf("webhook body missing event data: %s", captured[1].body)
	}
}

func TestParity_Webhook_Test(t *testing.T) {
	var mu sync.Mutex
	captured := make([][]byte, 0, 2)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		captured = append(captured, body)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()

	client := webhook.NewClient(5 * time.Second)
	cfg := intmodel.WebhookConfig{URL: srv.URL, Method: "POST", ContentType: "application/json"}
	cfgMap := map[string]any{"url": srv.URL, "method": "POST", "content_type": "application/json"}

	// OLD test path (integration_service.Test webhook branch).
	oldEvt, _ := events.NewEvent("integration.test", "notification-service", "tenant-T", map[string]any{"title": "Integration test"})
	oldCode, oldBody, oldErr := client.Post(context.Background(), cfg, oldEvt)

	// NEW test path through the registry with tenant carried on the context.
	r := BuildDefaultRegistry(Clients{Webhook: client})
	ctx := WithTenant(context.Background(), "tenant-T")
	res, newErr := r.Test(ctx, string(intmodel.IntegrationTypeWebhook), cfgMap)

	if oldCode != res.ResponseCode || oldBody != res.ResponseBody {
		t.Fatalf("webhook test parity mismatch: old=(%d,%q) new=(%d,%q)", oldCode, oldBody, res.ResponseCode, res.ResponseBody)
	}
	if (oldErr == nil) != (newErr == nil) {
		t.Fatalf("webhook test error parity: old=%v new=%v", oldErr, newErr)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(captured) != 2 {
		t.Fatalf("expected 2 captured requests, got %d", len(captured))
	}
	// Both test events carry tenant-T and the integration.test type/title;
	// only the random event ID/time differ, so assert on the stable fields.
	var oldP, newP map[string]any
	_ = json.Unmarshal(captured[0], &oldP)
	_ = json.Unmarshal(captured[1], &newP)
	if oldP["tenant_id"] != newP["tenant_id"] || oldP["tenant_id"] != "tenant-T" {
		t.Errorf("tenant parity: old=%v new=%v", oldP["tenant_id"], newP["tenant_id"])
	}
	if oldP["type"] != newP["type"] || !strings.Contains(asString(newP["type"]), "integration.test") {
		t.Errorf("type parity: old=%v new=%v", oldP["type"], newP["type"])
	}
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}

// ===========================================================================
// PARITY: JIRA — legacy Service.CreateFromEntity vs registry CreateFromEntity.
// The CreateIssue call hits a real httptest Jira server; the resulting
// ExternalTicketLink (old) and ExternalRef (new) must agree.
// ===========================================================================

func newJiraTestServer(t *testing.T) (*httptest.Server, *int) {
	t.Helper()
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/rest/api/3/issue" {
			calls++
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"10100","key":"SEC-42"}`))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func TestParity_Jira_CreateFromEntity(t *testing.T) {
	srv, calls := newJiraTestServer(t)

	clario := &fakeClario{entity: map[string]any{"title": "Suspicious login", "severity": "critical"}}
	links := &fakeLinkStore{}
	jiraClient := jira.NewClient(5 * time.Second)
	svc := jira.NewTicketService(jiraClient, clario, links, "https://app.clario.dev")

	integration := testIntegration(intmodel.IntegrationTypeJira)
	cfg := intmodel.JiraConfig{BaseURL: srv.URL, ProjectKey: "SEC", AuthToken: "jira-token"}
	cfgMap := map[string]any{"base_url": srv.URL, "project_key": "SEC", "auth_token": "jira-token"}

	// OLD path.
	oldLink, oldCode, oldBody, oldErr := svc.CreateFromEntity(context.Background(), integration, cfg, "sys-token", "alert", "alert-7")
	if oldErr != nil {
		t.Fatalf("old jira CreateFromEntity: %v", oldErr)
	}

	// NEW path via registry, integration carried on context.
	r := BuildDefaultRegistry(Clients{Jira: svc})
	ctx := WithIntegration(context.Background(), integration)
	res, newErr := r.CreateFromEntity(ctx, string(intmodel.IntegrationTypeJira), cfgMap, "sys-token", "alert", "alert-7")
	if newErr != nil {
		t.Fatalf("new jira CreateFromEntity: %v", newErr)
	}

	if *calls != 2 {
		t.Fatalf("expected 2 jira CreateIssue calls, got %d", *calls)
	}
	if oldCode != res.ResponseCode || oldBody != res.ResponseBody {
		t.Fatalf("jira parity mismatch: old=(%d,%q) new=(%d,%q)", oldCode, oldBody, res.ResponseCode, res.ResponseBody)
	}
	if res.ExternalRef == nil {
		t.Fatal("new jira path produced no ExternalRef")
	}
	if res.ExternalRef.ExternalID != oldLink.ExternalID || res.ExternalRef.ExternalKey != oldLink.ExternalKey {
		t.Fatalf("jira ExternalRef mismatch: ref=%+v link.id=%s link.key=%s", res.ExternalRef, oldLink.ExternalID, oldLink.ExternalKey)
	}
	if res.ExternalRef.ExternalKey != "SEC-42" || res.ExternalRef.System != "jira" {
		t.Fatalf("jira ExternalRef wrong: %+v", res.ExternalRef)
	}
	if res.ExternalRef.URL != oldLink.ExternalURL {
		t.Fatalf("jira URL mismatch: ref=%q link=%q", res.ExternalRef.URL, oldLink.ExternalURL)
	}
}

func TestParity_Jira_Test(t *testing.T) {
	srv, calls := newJiraTestServer(t)
	clario := &fakeClario{entity: map[string]any{}}
	svc := jira.NewTicketService(jira.NewClient(5*time.Second), clario, &fakeLinkStore{}, "https://app.clario.dev")
	cfg := intmodel.JiraConfig{BaseURL: srv.URL, ProjectKey: "SEC", AuthToken: "jira-token"}
	cfgMap := map[string]any{"base_url": srv.URL, "project_key": "SEC", "auth_token": "jira-token"}

	payload := map[string]any{
		"fields": map[string]any{
			"project":     map[string]any{"key": cfg.ProjectKey},
			"summary":     "[Clario 360 Test] Integration connectivity check",
			"description": jira.BuildADF(map[string]any{"title": "Integration test", "description": "Generated by Clario 360"}, ""),
		},
	}
	_, oldCode, oldBody, oldErr := svc.RawClient().CreateIssue(context.Background(), cfg, payload)

	r := BuildDefaultRegistry(Clients{Jira: svc})
	res, newErr := r.Test(context.Background(), string(intmodel.IntegrationTypeJira), cfgMap)

	if *calls != 2 {
		t.Fatalf("expected 2 jira CreateIssue calls, got %d", *calls)
	}
	if oldCode != res.ResponseCode || oldBody != res.ResponseBody {
		t.Fatalf("jira test parity mismatch: old=(%d,%q) new=(%d,%q)", oldCode, oldBody, res.ResponseCode, res.ResponseBody)
	}
	if (oldErr == nil) != (newErr == nil) {
		t.Fatalf("jira test error parity: old=%v new=%v", oldErr, newErr)
	}
}

// ===========================================================================
// PARITY: SERVICENOW — legacy Service.CreateFromEntity vs registry.
// ===========================================================================

func newServiceNowTestServer(t *testing.T) (*httptest.Server, *int) {
	t.Helper()
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/api/now/table/incident" {
			calls++
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"result":{"sys_id":"abc123","number":"INC0010042"}}`))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func TestParity_ServiceNow_CreateFromEntity(t *testing.T) {
	srv, calls := newServiceNowTestServer(t)

	clario := &fakeClario{entity: map[string]any{"title": "Malware found", "severity": "critical"}}
	links := &fakeLinkStore{}
	snClient := servicenow.NewClient(5 * time.Second)
	svc := servicenow.NewIncidentService(snClient, clario, links, "https://app.clario.dev")

	integration := testIntegration(intmodel.IntegrationTypeServiceNow)
	cfg := intmodel.ServiceNowConfig{InstanceURL: srv.URL, AuthType: "basic", Username: "u", Password: "p"}
	cfgMap := map[string]any{"instance_url": srv.URL, "auth_type": "basic", "username": "u", "password": "p"}

	oldLink, oldCode, oldBody, oldErr := svc.CreateFromEntity(context.Background(), integration, cfg, "sys-token", "alert", "alert-9")
	if oldErr != nil {
		t.Fatalf("old servicenow CreateFromEntity: %v", oldErr)
	}

	r := BuildDefaultRegistry(Clients{ServiceNow: svc})
	ctx := WithIntegration(context.Background(), integration)
	res, newErr := r.CreateFromEntity(ctx, string(intmodel.IntegrationTypeServiceNow), cfgMap, "sys-token", "alert", "alert-9")
	if newErr != nil {
		t.Fatalf("new servicenow CreateFromEntity: %v", newErr)
	}

	if *calls != 2 {
		t.Fatalf("expected 2 servicenow CreateIncident calls, got %d", *calls)
	}
	if oldCode != res.ResponseCode || oldBody != res.ResponseBody {
		t.Fatalf("servicenow parity mismatch: old=(%d,%q) new=(%d,%q)", oldCode, oldBody, res.ResponseCode, res.ResponseBody)
	}
	if res.ExternalRef == nil {
		t.Fatal("new servicenow path produced no ExternalRef")
	}
	if res.ExternalRef.ExternalID != oldLink.ExternalID || res.ExternalRef.ExternalKey != oldLink.ExternalKey {
		t.Fatalf("servicenow ExternalRef mismatch: ref=%+v link.id=%s link.key=%s", res.ExternalRef, oldLink.ExternalID, oldLink.ExternalKey)
	}
	if res.ExternalRef.ExternalKey != "INC0010042" || res.ExternalRef.ExternalID != "abc123" || res.ExternalRef.System != "servicenow" {
		t.Fatalf("servicenow ExternalRef wrong: %+v", res.ExternalRef)
	}
	if res.ExternalRef.URL != oldLink.ExternalURL {
		t.Fatalf("servicenow URL mismatch: ref=%q link=%q", res.ExternalRef.URL, oldLink.ExternalURL)
	}
}

func TestParity_ServiceNow_Test(t *testing.T) {
	srv, calls := newServiceNowTestServer(t)
	svc := servicenow.NewIncidentService(servicenow.NewClient(5*time.Second), &fakeClario{entity: map[string]any{}}, &fakeLinkStore{}, "https://app.clario.dev")
	cfg := intmodel.ServiceNowConfig{InstanceURL: srv.URL, AuthType: "basic", Username: "u", Password: "p"}
	cfgMap := map[string]any{"instance_url": srv.URL, "auth_type": "basic", "username": "u", "password": "p"}

	payload := map[string]any{
		"short_description": "[Clario 360 Test] Integration connectivity check",
		"description":       "Generated by Clario 360 to verify ServiceNow connectivity.",
		"urgency":           3,
		"impact":            3,
		"category":          firstNonEmpty(cfg.Category, "Security"),
		"subcategory":       firstNonEmpty(cfg.Subcategory, "Threat Detection"),
	}
	_, oldCode, oldBody, oldErr := svc.RawClient().CreateIncident(context.Background(), cfg, payload)

	r := BuildDefaultRegistry(Clients{ServiceNow: svc})
	res, newErr := r.Test(context.Background(), string(intmodel.IntegrationTypeServiceNow), cfgMap)

	if *calls != 2 {
		t.Fatalf("expected 2 servicenow CreateIncident calls, got %d", *calls)
	}
	if oldCode != res.ResponseCode || oldBody != res.ResponseBody {
		t.Fatalf("servicenow test parity mismatch: old=(%d,%q) new=(%d,%q)", oldCode, oldBody, res.ResponseCode, res.ResponseBody)
	}
	if (oldErr == nil) != (newErr == nil) {
		t.Fatalf("servicenow test error parity: old=%v new=%v", oldErr, newErr)
	}
}

// ===========================================================================
// PARITY: TEAMS — the Bot Framework token endpoint is hardcoded to
// login.microsoftonline.com, so we cannot redirect Send to httptest without
// modifying client code (forbidden). Instead we assert behavior preservation:
// for the same (unreachable-token) input, the legacy client.Send and the
// registry dispatch must FAIL IDENTICALLY (same error contract, no divergence).
// This is a real call (the HTTP token fetch is attempted), not a mock.
// ===========================================================================

func TestParity_Teams_Send_ErrorContract(t *testing.T) {
	// Point the token endpoint at a black hole by giving credentials that the
	// real endpoint rejects; both paths must surface an error and a zero code.
	client := teams.NewClient(2*time.Second, "https://app.clario.dev")
	cfg := intmodel.TeamsConfig{
		BotAppID:       "00000000-0000-0000-0000-000000000000",
		BotPassword:    "invalid-secret",
		ServiceURL:     "https://smba.example.invalid",
		ConversationID: "19:conv@thread.tacv2",
	}
	cfgMap := map[string]any{
		"bot_app_id":      cfg.BotAppID,
		"bot_password":    cfg.BotPassword,
		"service_url":     cfg.ServiceURL,
		"conversation_id": cfg.ConversationID,
	}
	evt := testEvent(t, "cyber.alert.created", map[string]any{"title": "x"})

	oldCode, oldBody, oldErr := client.Send(context.Background(), cfg, evt)

	// Use a SEPARATE client instance for the new path so a cached token from the
	// old path cannot mask a divergence (token cache is per-client).
	client2 := teams.NewClient(2*time.Second, "https://app.clario.dev")
	r := BuildDefaultRegistry(Clients{Teams: client2})
	res, newErr := r.Send(context.Background(), string(intmodel.IntegrationTypeTeams), cfgMap, evt)

	if (oldErr == nil) != (newErr == nil) {
		t.Fatalf("teams error-contract parity broke: old=%v new=%v", oldErr, newErr)
	}
	if oldErr == nil {
		// Unexpected in CI (no creds), but if it somehow succeeded both must agree.
		if oldCode != res.ResponseCode {
			t.Fatalf("teams success-code parity: old=%d new=%d", oldCode, res.ResponseCode)
		}
		return
	}
	// Both failed: codes must match (both 0 — failure before any upstream status).
	if oldCode != res.ResponseCode {
		t.Fatalf("teams failure-code parity: old=%d new=%d", oldCode, res.ResponseCode)
	}
	if oldBody != res.ResponseBody {
		t.Fatalf("teams failure-body parity: old=%q new=%q", oldBody, res.ResponseBody)
	}
}

// TestParity_Teams_Send_RealHTTP exercises the activity POST path with a real
// httptest server by injecting a token-cache so the hardcoded token endpoint is
// never reached. The teams TokenProvider caches by client; we cannot prime it
// from this package without touching client code, so this case verifies the
// adapter forwards ServiceURL/ConversationID into the same endpoint the legacy
// path builds, by comparing the request the server receives when the token step
// is bypassed via a stub upstream that also serves the token route.
//
// Because the token endpoint host is fixed, we cannot fully bypass it; this test
// therefore focuses on the decode parity (config -> TeamsConfig) which the other
// teams test does not cover, ensuring the adapter passes through identical config.
func TestTeams_ConfigDecodeParity(t *testing.T) {
	cfgMap := map[string]any{
		"bot_app_id":      "app-1",
		"bot_password":    "pw",
		"service_url":     "https://smba.example/",
		"conversation_id": "conv-1",
		"tenant_id":       "aad-tenant",
	}
	var decoded intmodel.TeamsConfig
	if err := decodeInto(cfgMap, &decoded); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := intmodel.TeamsConfig{
		BotAppID:       "app-1",
		BotPassword:    "pw",
		ServiceURL:     "https://smba.example/",
		ConversationID: "conv-1",
		TenantID:       "aad-tenant",
	}
	if decoded != want {
		t.Fatalf("teams config decode mismatch: got %+v want %+v", decoded, want)
	}
}
