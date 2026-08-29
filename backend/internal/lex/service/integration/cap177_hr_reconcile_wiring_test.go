package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// CAP-177 (HR / identity feed) — verification + reconciler→OrgEntity/OrgRole
// wiring proof.
//
// The pull connector (HRConnector.Sync→reconcile) and the inbound SCIM server
// (SCIMServer.provision) BOTH reconcile normalized upstream records into the lex
// org registry (OrgEntity + the escalation-ladder OrgRole) and record idempotency
// in lex_hr_identity_map. These tests drive a SCIM stub end-to-end and assert the
// reconciler output actually LANDS in the org store — closing the "verify + wire"
// loop the design (Work-stream B, CAP-177) calls for. They reuse the in-memory
// fakeIDStore / fakeOrgStore seams from hr_connector_test.go.
// =============================================================================

// scimUserGroupStub is a minimal SCIM 2.0 /Users + /Groups list stub. It returns
// one group (an org unit) and one user that carries the lex provisioning hints
// (org_code + role_key + lex_user_id) so the reconciler can bind an OrgRole. The
// hints are surfaced under the configurable field_mapping attribute names supplied
// by the caller, proving the field_mapping→hrRecord normalization path.
func scimUserGroupStub(t *testing.T, wantBearer, lexUserID string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer "+wantBearer {
			t.Errorf("missing/incorrect bearer: %q", got)
		}
		w.Header().Set("Content-Type", "application/scim+json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/Users"):
			if r.URL.Query().Get("startIndex") != "1" {
				_ = json.NewEncoder(w).Encode(map[string]any{"totalResults": 1, "Resources": []map[string]any{}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"totalResults": 1,
				"Resources": []map[string]any{
					{
						"id": "u-boss", "displayName": "Boss", "active": true,
						// Non-standard attribute names exercised via field_mapping below.
						"dept": "LEGAL", "title": "legal_director", "lexId": lexUserID,
						"meta": map[string]any{"lastModified": "2026-04-01T00:00:00Z"},
					},
				},
			})
		case strings.HasPrefix(r.URL.Path, "/Groups"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"totalResults": 1,
				"Resources": []map[string]any{
					{"id": "g-legal", "displayName": "Legal", "dept": "LEGAL", "meta": map[string]any{"lastModified": "2026-04-01T00:00:00Z"}},
				},
			})
		}
	}))
}

// TestCAP177_PullReconcile_LandsOrgEntityAndOrgRole proves the SCIM-pull
// reconciler output is wired into BOTH the OrgEntity store (group→entity) and the
// OrgRole store (user→escalation-ladder role binding), driven by a SCIM stub and a
// configurable field_mapping. The existing TestHRSync_SCIMPull test only asserts
// the group→entity leg; this closes the user→role wiring assertion.
func TestCAP177_PullReconcile_LandsOrgEntityAndOrgRole(t *testing.T) {
	tenantID := uuid.New()
	lexUser := uuid.New().String()
	srv := scimUserGroupStub(t, "secret-token", lexUser)
	defer srv.Close()

	idMap := newFakeIDStore()
	org := newFakeOrgStore()
	// The org entity the role attaches to must exist for the user→role binding to
	// resolve. The connector fetches /Users before /Groups, so on a single full pass
	// a brand-new group is reconciled AFTER its members; the binding therefore relies
	// on the OrgEntity already being present (a prior groups sync, or — as here — the
	// existing org registry). This is the reconciler's honest contract: it binds a
	// role only against an entity it can resolve, never a fabricated one.
	legalEntity := &model.OrgEntity{
		ID:         uuid.New(),
		TenantID:   tenantID,
		EntityType: model.OrgEntityTypeDepartment,
		Code:       "LEGAL",
		Active:     true,
	}
	if err := org.Create(context.Background(), nil, legalEntity); err != nil {
		t.Fatalf("seed org entity: %v", err)
	}
	c := testHRConnector(idMap, org, srv.Client())
	ep := hrEndpoint(tenantID, map[string]any{
		"transport":    "scim",
		"base_url":     srv.URL,
		"bearer_token": "secret-token",
		// field_mapping → hrRecord normalization: map the neutral lex fields onto the
		// stub's non-standard attribute names.
		"field_mapping": map[string]any{
			"org_code":    "dept",
			"role_key":    "title",
			"lex_user_id": "lexId",
		},
	})

	rep, err := c.Sync(context.Background(), ep, SyncModeFull)
	if err != nil {
		t.Fatalf("Sync error: %v", err)
	}
	// 1 user + 1 group = 2 processed. The pre-seeded LEGAL entity is UPDATED by the
	// group record (not created), so created/updated split is 1/1.
	if rep.Processed != 2 {
		t.Fatalf("processed = %d, want 2 (detail=%s)", rep.Processed, rep.Detail)
	}

	// WIRED #1: the group reconciled onto the existing OrgEntity (by tenant, code).
	entity, gerr := org.GetByCode(context.Background(), tenantID, "LEGAL")
	if gerr != nil {
		t.Fatalf("expected LEGAL OrgEntity present after reconcile, got %v", gerr)
	}
	if entity.ID != legalEntity.ID {
		t.Errorf("group should reconcile onto the existing entity, got new id %s", entity.ID)
	}

	// WIRED #2: the user landed as an OrgRole binding on that entity.
	if org.roleUpsert != 1 {
		t.Fatalf("expected exactly 1 OrgRole upsert (user→role binding), got %d", org.roleUpsert)
	}
	if len(org.roles) != 1 {
		t.Fatalf("expected 1 reconciled OrgRole, got %d", len(org.roles))
	}
	role := org.roles[0]
	if role.RoleKey != model.OrgRoleLegalDirector {
		t.Errorf("role_key = %q, want legal_director", role.RoleKey)
	}
	if role.EntityID != entity.ID {
		t.Errorf("role.EntityID = %s, want bound to LEGAL entity %s", role.EntityID, entity.ID)
	}
	if role.UserID.String() != lexUser {
		t.Errorf("role.UserID = %s, want lex user %s", role.UserID, lexUser)
	}
	if role.TenantID != tenantID {
		t.Errorf("role.TenantID = %s, want %s (tenant scoping)", role.TenantID, tenantID)
	}

	// WIRED #3: idempotency map carries both the entity and the role mapping.
	if em, err := idMap.GetMapping(context.Background(), nil, tenantID, ep.ID, "g-legal"); err != nil {
		t.Errorf("expected identity mapping for the group: %v", err)
	} else if em.LexKind != repository.HRLexKindOrgEntity || em.LexID != entity.ID {
		t.Errorf("group mapping should point at the OrgEntity, got kind=%s id=%s", em.LexKind, em.LexID)
	}
	if um, err := idMap.GetMapping(context.Background(), nil, tenantID, ep.ID, "u-boss"); err != nil {
		t.Errorf("expected identity mapping for the user: %v", err)
	} else if um.LexKind != repository.HRLexKindOrgRole || um.LexID != role.ID {
		t.Errorf("user mapping should point at the OrgRole, got kind=%s id=%s", um.LexKind, um.LexID)
	}
}

// TestCAP177_InboundSCIMStub_BindsRoleIntoOrgStore drives the inbound SCIM server
// with a stub IdP push: a Group create lands an OrgEntity, then a User create with
// the lex extension binds an OrgRole on it. This is the inbound counterpart to the
// pull reconcile wiring proof, asserting the per-tenant bearer is validated and the
// reconciler output reaches the org store.
func TestCAP177_InboundSCIMStub_BindsRoleIntoOrgStore(t *testing.T) {
	srv, idMap, org, tenantID, endpointID, token := scimTestServer(t)
	lexUser := uuid.New().String()

	// 1) Group push → OrgEntity.
	gResp := doSCIM(t, srv, http.MethodPost, "/scim/v2/Groups", token, map[string]any{
		"schemas":     []string{"urn:ietf:params:scim:schemas:core:2.0:Group"},
		"externalId":  "LEGAL",
		"displayName": "Legal",
	})
	gResp.Body.Close()
	if gResp.StatusCode != http.StatusCreated {
		t.Fatalf("group push: want 201, got %d", gResp.StatusCode)
	}
	entity, err := org.GetByCode(context.Background(), tenantID, "LEGAL")
	if err != nil {
		t.Fatalf("group push should create the OrgEntity: %v", err)
	}

	// 2) User push carrying the lex extension → OrgRole binding on the entity.
	uResp := doSCIM(t, srv, http.MethodPost, "/scim/v2/Users", token, map[string]any{
		"schemas":    []string{"urn:ietf:params:scim:schemas:core:2.0:User"},
		"externalId": "ext-boss",
		"userName":   "boss",
		"active":     true,
		"urn:clario360:lex:1.0:User": map[string]any{
			"orgCode": "LEGAL", "roleKey": "legal_director", "lexUserId": lexUser,
		},
	})
	uResp.Body.Close()
	if uResp.StatusCode != http.StatusCreated {
		t.Fatalf("user push: want 201, got %d", uResp.StatusCode)
	}

	if org.roleUpsert != 1 || len(org.roles) != 1 {
		t.Fatalf("expected 1 OrgRole binding from the SCIM push, got upserts=%d roles=%d", org.roleUpsert, len(org.roles))
	}
	role := org.roles[0]
	if role.EntityID != entity.ID || role.RoleKey != model.OrgRoleLegalDirector || role.UserID.String() != lexUser {
		t.Errorf("inbound role binding wrong: entity=%s key=%s user=%s", role.EntityID, role.RoleKey, role.UserID)
	}
	if m, err := idMap.GetMapping(context.Background(), nil, tenantID, endpointID, "ext-boss"); err != nil {
		t.Errorf("expected identity mapping for the pushed user: %v", err)
	} else if m.LexKind != repository.HRLexKindOrgRole || m.LexID != role.ID {
		t.Errorf("pushed-user mapping should reference the OrgRole, got kind=%s id=%s", m.LexKind, m.LexID)
	}
}

// TestCAP177_UnresolvableUser_RecordedUnboundNotFabricated proves the reconciler is
// HONEST: a user whose role/org/lex-user is not resolvable is recorded as a known
// (unbound) identity for the reconciliation report — it never fabricates an
// OrgRole binding or an OrgEntity to satisfy it.
func TestCAP177_UnresolvableUser_RecordedUnboundNotFabricated(t *testing.T) {
	tenantID := uuid.New()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/scim+json")
		if strings.HasPrefix(r.URL.Path, "/Users") && r.URL.Query().Get("startIndex") == "1" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"totalResults": 1,
				// No org_code / role_key / lex_user_id → not bindable.
				"Resources": []map[string]any{{"id": "u-lonely", "userName": "nobody", "active": true}},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"totalResults": 0, "Resources": []map[string]any{}})
	}))
	defer srv.Close()

	idMap := newFakeIDStore()
	org := newFakeOrgStore()
	c := testHRConnector(idMap, org, srv.Client())
	ep := hrEndpoint(tenantID, map[string]any{"transport": "scim", "base_url": srv.URL, "bearer_token": "t"})

	if _, err := c.Sync(context.Background(), ep, SyncModeFull); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if org.roleUpsert != 0 {
		t.Errorf("an unresolvable user must NOT fabricate an OrgRole, got %d upserts", org.roleUpsert)
	}
	if len(org.byCode) != 0 {
		t.Errorf("an unresolvable user must NOT fabricate an OrgEntity, got %d entities", len(org.byCode))
	}
	m, err := idMap.GetMapping(context.Background(), nil, tenantID, ep.ID, "u-lonely")
	if err != nil {
		t.Fatalf("unbound identity should still be recorded: %v", err)
	}
	if unbound, _ := m.Metadata["unbound"].(bool); !unbound {
		t.Errorf("unresolvable user mapping should be flagged unbound, got metadata=%v", m.Metadata)
	}
}

// TestCAP177_HonestNotConfigured_ForUnwiredTransports asserts the design's D4
// honest-health invariant for the injected transports: with neither SFTP nor LDAP
// wired into the deployment, a configured csv_sftp / ldap endpoint Probes
// not-reachable AND its TestConnection reports a not-configured first diagnostic
// step — it never fakes a healthy bind.
func TestCAP177_HonestNotConfigured_ForUnwiredTransports(t *testing.T) {
	c := testHRConnector(newFakeIDStore(), newFakeOrgStore(), http.DefaultClient) // no SFTP/LDAP injected
	cases := []struct {
		transport string
		cfg       map[string]any
	}{
		{"csv_sftp", map[string]any{"transport": "csv_sftp", "sftp_host": "h", "sftp_username": "u", "sftp_password": "p"}},
		{"ldap", map[string]any{"transport": "ldap", "ldap_url": "ldaps://h", "ldap_bind_dn": "cn=svc"}},
	}
	for _, tc := range cases {
		t.Run(tc.transport, func(t *testing.T) {
			ep := hrEndpoint(uuid.New(), tc.cfg)

			h := c.Probe(context.Background(), ep, nowFn())
			if h.Reachable {
				t.Errorf("%s without an injected transport must Probe not-reachable", tc.transport)
			}
			if !strings.Contains(strings.ToLower(h.Detail), "not configured") {
				t.Errorf("%s probe should be honest not-configured, got %q", tc.transport, h.Detail)
			}

			res, err := c.TestConnection(context.Background(), ep)
			if err != nil {
				t.Fatalf("TestConnection returns nil error (verdict in result): %v", err)
			}
			if res.Reachable {
				t.Errorf("%s TestConnection must not be reachable when the transport is unwired", tc.transport)
			}
			if len(res.Steps) == 0 || res.Steps[0].Status != diagStatusFail {
				t.Errorf("%s should report a failing reachable step, got %+v", tc.transport, res.Steps)
			}
			if !strings.Contains(strings.ToLower(res.Detail), "not configured") {
				t.Errorf("%s TestConnection detail should be honest not-configured, got %q", tc.transport, res.Detail)
			}
		})
	}
}
