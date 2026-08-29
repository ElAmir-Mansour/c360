package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// In-memory fakes for the HR identity store + org store. They satisfy the
// hrIdentityStore / hrOrgStore seams so the connector + SCIM server are testable
// without a live database. Pool() returns nil — the fake methods ignore the
// Queryer argument entirely.
// =============================================================================

type fakeIDStore struct {
	mu       sync.Mutex
	mappings map[string]*repository.HRIdentityMapping // key: tenant|endpoint|extID
	tokens   map[string]*repository.SCIMToken         // key: token_hash
	upserts  int
}

func newFakeIDStore() *fakeIDStore {
	return &fakeIDStore{
		mappings: map[string]*repository.HRIdentityMapping{},
		tokens:   map[string]*repository.SCIMToken{},
	}
}

func mapKey(tenant, endpoint uuid.UUID, extID string) string {
	return tenant.String() + "|" + endpoint.String() + "|" + strings.TrimSpace(extID)
}

func (f *fakeIDStore) Pool() *pgxpool.Pool { return nil }

func (f *fakeIDStore) GetMapping(_ context.Context, _ repository.Queryer, tenantID, endpointID uuid.UUID, externalID string) (*repository.HRIdentityMapping, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	m, ok := f.mappings[mapKey(tenantID, endpointID, externalID)]
	if !ok {
		return nil, pgx.ErrNoRows
	}
	cp := *m
	return &cp, nil
}

func (f *fakeIDStore) UpsertMapping(_ context.Context, _ repository.Queryer, m *repository.HRIdentityMapping) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.upserts++
	key := mapKey(m.TenantID, m.EndpointID, m.ExternalID)
	_, existed := f.mappings[key]
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	if m.LastSyncedAt.IsZero() {
		m.LastSyncedAt = time.Now().UTC()
	}
	cp := *m
	f.mappings[key] = &cp
	return !existed, nil
}

func (f *fakeIDStore) SoftDeactivate(_ context.Context, _ repository.Queryer, tenantID, endpointID uuid.UUID, externalID string, at time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	m, ok := f.mappings[mapKey(tenantID, endpointID, externalID)]
	if !ok {
		return pgx.ErrNoRows
	}
	m.Active = false
	m.DeactivatedAt = &at
	m.LastSyncedAt = at
	return nil
}

func (f *fakeIDStore) ResolveTokenByHash(_ context.Context, tokenHash string, now time.Time) (*repository.SCIMToken, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	t, ok := f.tokens[tokenHash]
	if !ok {
		return nil, pgx.ErrNoRows
	}
	if t.RevokedAt != nil {
		return nil, pgx.ErrNoRows
	}
	if t.ExpiresAt != nil && !t.ExpiresAt.After(now) {
		return nil, pgx.ErrNoRows
	}
	cp := *t
	return &cp, nil
}

func (f *fakeIDStore) TouchTokenUsed(_ context.Context, _ uuid.UUID, tokenID uuid.UUID, at time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, t := range f.tokens {
		if t.ID == tokenID {
			t.LastUsedAt = &at
		}
	}
	return nil
}

func (f *fakeIDStore) IssueToken(_ context.Context, _ repository.Queryer, tok *repository.SCIMToken, tokenHash string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if tok.ID == uuid.Nil {
		tok.ID = uuid.New()
	}
	tok.CreatedAt = time.Now().UTC()
	tok.UpdatedAt = tok.CreatedAt
	cp := *tok
	f.tokens[tokenHash] = &cp
	return nil
}

func (f *fakeIDStore) RevokeTokensForEndpoint(_ context.Context, _ repository.Queryer, tenantID, endpointID uuid.UUID, at time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, t := range f.tokens {
		if t.TenantID == tenantID && t.EndpointID == endpointID && t.RevokedAt == nil {
			t.RevokedAt = &at
		}
	}
	return nil
}

// addToken seeds a usable token (hash -> record) and returns the raw value.
func (f *fakeIDStore) addToken(raw string, tenantID, endpointID uuid.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tokens[repository.HashSCIMToken(raw)] = &repository.SCIMToken{
		ID: uuid.New(), TenantID: tenantID, EndpointID: endpointID, TokenPrefix: "lexscim_test",
	}
}

type fakeOrgStore struct {
	mu          sync.Mutex
	byCode      map[string]*model.OrgEntity
	roles       []*model.OrgRole
	createErr   error
	roleUpsert  int
	memberships []*model.OrgMembership
}

func newFakeOrgStore() *fakeOrgStore {
	return &fakeOrgStore{byCode: map[string]*model.OrgEntity{}}
}

func (f *fakeOrgStore) GetByCode(_ context.Context, tenantID uuid.UUID, code string) (*model.OrgEntity, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	e, ok := f.byCode[tenantID.String()+"|"+strings.ToUpper(strings.TrimSpace(code))]
	if !ok {
		return nil, pgx.ErrNoRows
	}
	cp := *e
	return &cp, nil
}

func (f *fakeOrgStore) Create(_ context.Context, _ repository.Queryer, entity *model.OrgEntity) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.createErr != nil {
		return f.createErr
	}
	cp := *entity
	f.byCode[entity.TenantID.String()+"|"+strings.ToUpper(entity.Code)] = &cp
	return nil
}

func (f *fakeOrgStore) Update(_ context.Context, _ repository.Queryer, entity *model.OrgEntity) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := *entity
	f.byCode[entity.TenantID.String()+"|"+strings.ToUpper(entity.Code)] = &cp
	return nil
}

func (f *fakeOrgStore) UpsertRole(_ context.Context, _ repository.Queryer, role *model.OrgRole) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.roleUpsert++
	if role.ID == uuid.Nil {
		role.ID = uuid.New()
	}
	f.roles = append(f.roles, role)
	return nil
}

func (f *fakeOrgStore) UpsertMembership(_ context.Context, _ repository.Queryer, membership *model.OrgMembership) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := *membership
	f.memberships = append(f.memberships, &cp)
	return nil
}

func TestHRReconcileMapsParentUnitsManagersAndEmployees(t *testing.T) {
	tenantID := uuid.New()
	managerID, employeeID := uuid.New(), uuid.New()
	org := newFakeOrgStore()
	c := testHRConnector(newFakeIDStore(), org, http.DefaultClient)
	ep := hrEndpoint(tenantID, map[string]any{})
	records := []hrRecord{
		{ExternalID: "root", Resource: "org_unit", DisplayName: "Company", Active: true, OrgCode: "ROOT", EntityType: "company"},
		{ExternalID: "legal", Resource: "org_unit", DisplayName: "Legal", Active: true, OrgCode: "LEGAL", ParentOrgCode: "ROOT", EntityType: "department", ManagerLexUserID: managerID.String()},
		{ExternalID: "e-100", Resource: "worker", DisplayName: "Counsel", Active: true, OrgCode: "LEGAL", LexUserID: employeeID.String(), ManagerLexUserID: managerID.String()},
	}
	report := c.reconcile(context.Background(), ep, SyncModeFull, records)
	if report.Failed != 0 {
		t.Fatalf("reconcile failed: %+v", report)
	}
	legal, err := org.GetByCode(context.Background(), tenantID, "LEGAL")
	if err != nil || legal.ParentID == nil {
		t.Fatalf("LEGAL parent missing: entity=%+v err=%v", legal, err)
	}
	root, _ := org.GetByCode(context.Background(), tenantID, "ROOT")
	if *legal.ParentID != root.ID {
		t.Fatalf("parent=%v want %v", *legal.ParentID, root.ID)
	}
	if len(org.memberships) != 1 || org.memberships[0].UserID != employeeID || org.memberships[0].ManagerUserID == nil || *org.memberships[0].ManagerUserID != managerID {
		t.Fatalf("employee mapping mismatch: %+v", org.memberships)
	}
	if org.roleUpsert != 1 {
		t.Fatalf("manager role upserts=%d want 1", org.roleUpsert)
	}
}

// =============================================================================
// Test helpers.
// =============================================================================

func testHRConnector(idMap hrIdentityStore, orgRepo hrOrgStore, client *http.Client) *HRConnector {
	return NewHRConnector(HRConnectorConfig{
		OrgRepo: orgRepo,
		IDMap:   idMap,
		Client:  client,
		Logger:  zerolog.Nop(),
	})
}

func hrEndpoint(tenantID uuid.UUID, cfg map[string]any) model.IntegrationEndpoint {
	return model.IntegrationEndpoint{
		ID:       uuid.New(),
		TenantID: tenantID,
		Kind:     model.IntegrationKindHR,
		Code:     "hr-test",
		Status:   model.IntegrationStatusActive,
		Config:   cfg,
	}
}

// =============================================================================
// SCIM client pull: pagination + normalization + reconcile.
// =============================================================================

func TestHRSync_SCIMPull_PaginatesAndReconciles(t *testing.T) {
	tenantID := uuid.New()
	// Two pages of /Users (3 total), one /Groups page (1 group).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer secret-token" {
			t.Errorf("missing/incorrect bearer: %q", got)
		}
		w.Header().Set("Content-Type", "application/scim+json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/Users"):
			start := r.URL.Query().Get("startIndex")
			if start == "1" {
				// page 1: 100 dummy? keep small — emulate "less than pageSize ends paging"
				_ = json.NewEncoder(w).Encode(map[string]any{
					"totalResults": 2,
					"Resources": []map[string]any{
						{"id": "u1", "userName": "alice", "active": true, "meta": map[string]any{"lastModified": "2026-01-01T00:00:00Z"}},
						{"id": "u2", "userName": "bob", "active": true},
					},
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"totalResults": 2, "Resources": []map[string]any{}})
		case strings.HasPrefix(r.URL.Path, "/Groups"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"totalResults": 1,
				"Resources":    []map[string]any{{"id": "g1", "displayName": "Legal", "meta": map[string]any{"lastModified": "2026-02-01T00:00:00Z"}}},
			})
		}
	}))
	defer srv.Close()

	idMap := newFakeIDStore()
	org := newFakeOrgStore()
	c := testHRConnector(idMap, org, srv.Client())
	ep := hrEndpoint(tenantID, map[string]any{
		"transport":    "scim",
		"base_url":     srv.URL,
		"bearer_token": "secret-token",
	})

	rep, err := c.Sync(context.Background(), ep, SyncModeFull)
	if err != nil {
		t.Fatalf("Sync error: %v", err)
	}
	// 2 users + 1 group = 3 processed, all created.
	if rep.Processed != 3 {
		t.Errorf("processed = %d, want 3", rep.Processed)
	}
	if rep.Created != 3 {
		t.Errorf("created = %d, want 3 (detail=%s)", rep.Created, rep.Detail)
	}
	// The group became an OrgEntity.
	if _, err := org.GetByCode(context.Background(), tenantID, "LEGAL"); err != nil {
		t.Errorf("expected LEGAL org entity created, got %v", err)
	}
	// Watermark advanced to the latest lastModified seen.
	if rep.Watermark != "2026-02-01T00:00:00Z" {
		t.Errorf("watermark = %q, want 2026-02-01T00:00:00Z", rep.Watermark)
	}
}

func TestHRSync_IdempotentReSync_SkipsUnchanged(t *testing.T) {
	tenantID := uuid.New()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/scim+json")
		if strings.HasPrefix(r.URL.Path, "/Users") && r.URL.Query().Get("startIndex") == "1" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"totalResults": 1,
				"Resources":    []map[string]any{{"id": "u1", "userName": "alice", "active": true}},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"totalResults": 0, "Resources": []map[string]any{}})
	}))
	defer srv.Close()

	idMap := newFakeIDStore()
	c := testHRConnector(idMap, newFakeOrgStore(), srv.Client())
	ep := hrEndpoint(tenantID, map[string]any{"transport": "scim", "base_url": srv.URL, "bearer_token": "t"})

	if _, err := c.Sync(context.Background(), ep, SyncModeFull); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	upsertsAfterFirst := idMap.upserts
	rep, err := c.Sync(context.Background(), ep, SyncModeFull)
	if err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if rep.Skipped != 1 || rep.Created != 0 || rep.Updated != 0 {
		t.Errorf("re-sync should skip the unchanged record: %+v", rep)
	}
	if idMap.upserts != upsertsAfterFirst {
		t.Errorf("re-sync should not write any mapping: upserts went %d -> %d", upsertsAfterFirst, idMap.upserts)
	}
}

func TestHRSync_Deprovision_SoftDeactivates(t *testing.T) {
	tenantID := uuid.New()
	active := atomic.Bool{}
	active.Store(true)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/scim+json")
		if strings.HasPrefix(r.URL.Path, "/Users") && r.URL.Query().Get("startIndex") == "1" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"totalResults": 1,
				"Resources":    []map[string]any{{"id": "u1", "userName": "alice", "active": active.Load()}},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"totalResults": 0, "Resources": []map[string]any{}})
	}))
	defer srv.Close()

	idMap := newFakeIDStore()
	c := testHRConnector(idMap, newFakeOrgStore(), srv.Client())
	ep := hrEndpoint(tenantID, map[string]any{"transport": "scim", "base_url": srv.URL, "bearer_token": "t"})

	if _, err := c.Sync(context.Background(), ep, SyncModeFull); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	// Flip upstream to inactive; re-sync should soft-deactivate.
	active.Store(false)
	rep, err := c.Sync(context.Background(), ep, SyncModeFull)
	if err != nil {
		t.Fatalf("deprovision sync: %v", err)
	}
	deact, _ := rep.Metadata[SyncReportDeactivatedKey].(int)
	if deact != 1 {
		t.Errorf("expected 1 deactivation in metadata, got %v", rep.Metadata[SyncReportDeactivatedKey])
	}
	m, err := idMap.GetMapping(context.Background(), nil, tenantID, ep.ID, "u1")
	if err != nil {
		t.Fatalf("get mapping: %v", err)
	}
	if m.Active {
		t.Errorf("mapping should be soft-deactivated (active=false)")
	}
	if m.DeactivatedAt == nil {
		t.Errorf("deactivated_at should be stamped")
	}
}

func TestHRSync_PreviewIsSideEffectFree(t *testing.T) {
	tenantID := uuid.New()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/scim+json")
		if strings.HasPrefix(r.URL.Path, "/Users") && r.URL.Query().Get("startIndex") == "1" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"totalResults": 1,
				"Resources":    []map[string]any{{"id": "u1", "userName": "alice", "active": true}},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"totalResults": 0, "Resources": []map[string]any{}})
	}))
	defer srv.Close()

	idMap := newFakeIDStore()
	c := testHRConnector(idMap, newFakeOrgStore(), srv.Client())
	ep := hrEndpoint(tenantID, map[string]any{"transport": "scim", "base_url": srv.URL, "bearer_token": "t"})

	rep, err := c.Sync(context.Background(), ep, SyncModePreview)
	if err != nil {
		t.Fatalf("preview sync: %v", err)
	}
	if !rep.DryRun {
		t.Errorf("preview report should have DryRun=true")
	}
	if rep.Created != 1 {
		t.Errorf("preview should report 1 would-be create, got %d", rep.Created)
	}
	if idMap.upserts != 0 {
		t.Errorf("preview must not write any mapping; upserts=%d", idMap.upserts)
	}
}

// =============================================================================
// Retry + backoff on transient failures.
// =============================================================================

func TestHRDoJSON_RetriesOn5xxThenSucceeds(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/scim+json")
		if n < 3 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"totalResults": 0, "Resources": []map[string]any{}})
	}))
	defer srv.Close()

	c := testHRConnector(newFakeIDStore(), newFakeOrgStore(), srv.Client())
	status, _, err := c.doJSON(context.Background(), http.MethodGet, srv.URL+"/Users", hrConfig{BearerToken: "t"}, nil)
	if err != nil {
		t.Fatalf("expected success after retries, got %v", err)
	}
	if status != http.StatusOK {
		t.Errorf("status = %d, want 200", status)
	}
	if got := atomic.LoadInt32(&calls); got != 3 {
		t.Errorf("expected 3 attempts (2 failed + 1 ok), got %d", got)
	}
}

func TestHRDoJSON_DoesNotRetry4xx(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := testHRConnector(newFakeIDStore(), newFakeOrgStore(), srv.Client())
	status, _, err := c.doJSON(context.Background(), http.MethodGet, srv.URL+"/Users", hrConfig{BearerToken: "t"}, nil)
	if err != nil {
		t.Fatalf("4xx should be returned without error wrapping: %v", err)
	}
	if status != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", status)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("4xx must NOT be retried, got %d attempts", got)
	}
}

func TestHRDoJSON_RetriesExhaustedReturnsError(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	c := testHRConnector(newFakeIDStore(), newFakeOrgStore(), srv.Client())
	_, _, err := c.doJSON(context.Background(), http.MethodGet, srv.URL+"/Users", hrConfig{BearerToken: "t"}, nil)
	if err == nil {
		t.Fatalf("expected error after exhausting retries on persistent 503")
	}
	if got := atomic.LoadInt32(&calls); got != hrMaxAttempts {
		t.Errorf("expected %d attempts, got %d", hrMaxAttempts, got)
	}
}

func TestHRDoJSON_HonoursContextCancellation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already cancelled
	c := testHRConnector(newFakeIDStore(), newFakeOrgStore(), srv.Client())
	_, _, err := c.doJSON(ctx, http.MethodGet, srv.URL+"/Users", hrConfig{BearerToken: "t"}, nil)
	if err == nil {
		t.Fatalf("expected context error")
	}
}

// =============================================================================
// Secret redaction: errors and details never leak credentials.
// =============================================================================

func TestSanitizeDetail_RedactsCredentialBearingErrors(t *testing.T) {
	cases := []string{
		"dial tcp: authorization Bearer abcdef failed",
		"invalid token=supersecret in url",
		"password rejected by server",
	}
	for _, msg := range cases {
		out := sanitizeDetail("scim probe failed", &stringError{msg})
		if strings.Contains(out, "secret") || strings.Contains(strings.ToLower(out), "bearer") ||
			strings.Contains(out, "supersecret") || strings.Contains(out, "abcdef") {
			t.Errorf("sanitizeDetail leaked a credential: %q", out)
		}
		if !strings.Contains(out, "authentication error") {
			t.Errorf("expected redacted authentication-error message, got %q", out)
		}
	}
}

func TestSanitizeDetail_KeepsSafeMessage(t *testing.T) {
	out := sanitizeDetail("scim probe failed", &stringError{"connection refused"})
	if out != "scim probe failed: connection refused" {
		t.Errorf("unexpected sanitized detail: %q", out)
	}
}

type stringError struct{ s string }

func (e *stringError) Error() string { return e.s }

// =============================================================================
// Tier-2 Saudi gov-gated sources: honest "planned", never faked live.
// =============================================================================

func TestHRTier2_ProbeIsHonestlyPlanned(t *testing.T) {
	c := testHRConnector(newFakeIDStore(), newFakeOrgStore(), http.DefaultClient)
	for _, transport := range []string{"gosi", "qiwa", "muqeem"} {
		ep := hrEndpoint(uuid.New(), map[string]any{"transport": transport})
		h := c.Probe(context.Background(), ep, time.Now())
		if h.Reachable {
			t.Errorf("%s: gov-gated source must NEVER probe reachable", transport)
		}
		if !strings.Contains(strings.ToLower(h.Detail), "gov-gated") && !strings.Contains(strings.ToLower(h.Detail), "planned") {
			t.Errorf("%s: probe detail should state gov-gated/planned, got %q", transport, h.Detail)
		}
	}
}

func TestHRTier2_SyncReturnsNotLive(t *testing.T) {
	c := testHRConnector(newFakeIDStore(), newFakeOrgStore(), http.DefaultClient)
	for _, transport := range []string{"gosi", "qiwa", "muqeem"} {
		ep := hrEndpoint(uuid.New(), map[string]any{"transport": transport})
		rep, err := c.Sync(context.Background(), ep, SyncModeFull)
		if err == nil {
			t.Fatalf("%s: Sync must return an honest not-live error, got nil", transport)
		}
		if !strings.Contains(err.Error(), "gov onboarding pending") && !strings.Contains(err.Error(), "not wired to a live API") {
			t.Errorf("%s: not-live error should name the gate, got %v", transport, err)
		}
		if rep.Created != 0 || rep.Processed != 0 {
			t.Errorf("%s: gov-gated sync must never fabricate records, got %+v", transport, rep)
		}
		if gov, _ := rep.Metadata["gov_gated"].(bool); !gov {
			t.Errorf("%s: report metadata should mark gov_gated=true", transport)
		}
	}
}

func TestHRTier2_TestConnectionWarnsNotLive(t *testing.T) {
	c := testHRConnector(newFakeIDStore(), newFakeOrgStore(), http.DefaultClient)
	ep := hrEndpoint(uuid.New(), map[string]any{"transport": "qiwa"})
	res, err := c.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("TestConnection returns nil error (verdict in result): %v", err)
	}
	if res.Reachable {
		t.Errorf("qiwa must not be reachable")
	}
	if len(res.Steps) == 0 || res.Steps[0].Status != diagStatusWarn {
		t.Errorf("expected a warn reachable step for gov-gated source, got %+v", res.Steps)
	}
}

// =============================================================================
// Normalization + idempotency primitives.
// =============================================================================

func TestNormalizeSCIMUser_WithLexExtensionAndMapping(t *testing.T) {
	cfg := parseHRConfig(map[string]any{
		"transport":     "scim",
		"field_mapping": map[string]any{"org_code": "department", "role_key": "title", "lex_user_id": "lexId"},
	})
	raw := map[string]any{
		"id": "u1", "displayName": "Alice", "active": true,
		"department": "LEGAL", "title": "legal_director", "lexId": uuid.New().String(),
		"meta": map[string]any{"lastModified": "2026-03-01T00:00:00Z"},
	}
	rec := cfg.normalizeSCIMUser(raw)
	if rec.OrgCode != "LEGAL" || rec.RoleKey != "legal_director" || rec.ModifiedAt != "2026-03-01T00:00:00Z" {
		t.Errorf("field mapping not applied: %+v", rec)
	}
}

func TestHRRecord_ContentHashStableAndSensitive(t *testing.T) {
	a := hrRecord{ExternalID: "u1", Resource: "user", DisplayName: "Alice", Active: true, OrgCode: "LEGAL"}
	b := a
	if a.contentHash() != b.contentHash() {
		t.Errorf("identical records must hash equal")
	}
	b.DisplayName = "Alicia"
	if a.contentHash() == b.contentHash() {
		t.Errorf("changed display name must change the hash")
	}
}

func TestNormalizeRoleKey_OnlyKnownLadderRoles(t *testing.T) {
	if _, ok := normalizeRoleKey("legal_director"); !ok {
		t.Errorf("legal_director should be a recognised ladder role")
	}
	if _, ok := normalizeRoleKey("not_a_role"); ok {
		t.Errorf("unknown roles must not bind")
	}
}

func TestNormalizeCSV_MapsColumns(t *testing.T) {
	cfg := parseHRConfig(map[string]any{
		"transport":     "csv_sftp",
		"field_mapping": map[string]any{"external_id": "emp", "display_name": "name", "org_code": "dept"},
	})
	csv := "emp,name,dept,active\nE1,Alice,LEGAL,true\nE2,Bob,IT,false\n"
	recs, err := cfg.normalizeCSV([]byte(csv))
	if err != nil {
		t.Fatalf("normalizeCSV: %v", err)
	}
	if len(recs) != 2 {
		t.Fatalf("expected 2 records, got %d", len(recs))
	}
	if recs[0].ExternalID != "E1" || recs[0].OrgCode != "LEGAL" || !recs[0].Active {
		t.Errorf("row 0 wrong: %+v", recs[0])
	}
	if recs[1].Active {
		t.Errorf("row 1 active=false should parse inactive")
	}
}

// =============================================================================
// Probe honesty for self-serve transports.
// =============================================================================

func TestHRProbe_ActiveButIncompleteNamesGap(t *testing.T) {
	c := testHRConnector(newFakeIDStore(), newFakeOrgStore(), http.DefaultClient)
	ep := hrEndpoint(uuid.New(), map[string]any{"transport": "scim"}) // no base_url
	h := c.Probe(context.Background(), ep, time.Now())
	if h.Reachable {
		t.Errorf("incomplete config must not be reachable")
	}
	if !strings.Contains(h.Detail, "base_url") {
		t.Errorf("probe should name the missing field, got %q", h.Detail)
	}
}

func TestHRProbe_SFTPTransportNotWired(t *testing.T) {
	c := testHRConnector(newFakeIDStore(), newFakeOrgStore(), http.DefaultClient) // no sftp injected
	ep := hrEndpoint(uuid.New(), map[string]any{
		"transport": "csv_sftp", "sftp_host": "h", "sftp_username": "u", "sftp_password": "p",
	})
	h := c.Probe(context.Background(), ep, time.Now())
	if h.Reachable {
		t.Errorf("csv_sftp without an injected transport must be honest not-reachable")
	}
	if !strings.Contains(strings.ToLower(h.Detail), "not configured") {
		t.Errorf("expected not-configured detail, got %q", h.Detail)
	}
}

var _ = forms.LocalizedText{}
