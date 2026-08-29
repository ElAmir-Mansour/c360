package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	appconfig "github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/lex/service"
)

var lexBuildOutDomainRoutes = []struct {
	domain string
	method string
	path   string
}{
	{"Working Calendar", http.MethodGet, "/working-calendars"},
	{"Service Catalog & Intake", http.MethodPost, "/intake/submit"},
	{"Request spine, Priority & Approvals", http.MethodPost, "/requests/{id}/approval/start"},
	{"SLA, Acknowledgement & Escalation", http.MethodPost, "/sla/outbox/dispatch"},
	{"Execution Rules", http.MethodPost, "/requests/{requestId}/execution/delivery-confirmation/{confirmationId}/respond"},
	{"Litigation Case Mgmt & Classification", http.MethodGet, "/case-classifications/tree"},
	{"Plaintiff & Defendant Flows", http.MethodPost, "/legal-cases/{id}/defendant/{defendantId}/response-review"},
	{"Investigations", http.MethodPost, "/investigations/{id}/approval/{workflowInstanceId}/tasks/{taskId}/decision"},
	{"Case Timelines & Settlements/ADR", http.MethodPost, "/settlements/{id}/close"},
	{"Legal Consultations", http.MethodGet, "/consultations/count"},
	{"Contracts review-desk re-baseline", http.MethodPost, "/contracts/{id}/review-desk/recommendation"},
	{"Reporting & KPIs", http.MethodGet, "/kpis/sla-compliance"},
	{"Notification Triggers", http.MethodGet, "/notifications/inbox/counts"},
	{"RBAC, Attachments, i18n/RTL, Integrations, NFR", http.MethodGet, "/integrations/health"},
}

// Regression guard: (1) the FULL Lex build-out route set composes without a chi
// wildcard-param panic, and (2) at runtime chi resolves BOTH
// /requests/{id}/approval and /requests/{requestId}/execution to the right param
// key despite sharing the /requests/{...} position. go build/vet cannot catch
// either failure mode, and new phases keep adding routes under shared prefixes.
func TestFullLexBuildOutRouterComposes(t *testing.T) {
	logger := zerolog.Nop()
	deps := testRouteDependencies(logger)

	defer func() {
		if rec := recover(); rec != nil {
			t.Fatalf("router construction panicked (chi route conflict): %v", rec)
		}
	}()

	r := chi.NewRouter()
	RegisterRoutes(r, deps)

	const uid = "11111111-1111-1111-1111-111111111111"
	cases := []struct {
		method, path, key, want string
	}{
		{"GET", "/api/v1/lex/requests/" + uid + "/execution", "requestId", uid},
		{"POST", "/api/v1/lex/requests/" + uid + "/approval/start", "id", uid},
		{"GET", "/api/v1/watheeq/requests/" + uid + "/execution", "requestId", uid},
		// Phase 2: the case root + sub-resources resolve {id}; the intake decision
		// route shares the /legal-cases/{id} prefix yet still resolves {id}.
		{"GET", "/api/v1/lex/legal-cases/" + uid, "id", uid},
		{"POST", "/api/v1/lex/legal-cases/" + uid + "/intake/start", "id", uid},
		{"GET", "/api/v1/lex/case-classifications/" + uid + "/cascade", "id", uid},
		{"GET", "/api/v1/lex/case-classifications/" + uid + "/audit", "id", uid},
		{"GET", "/api/v1/lex/org-entities/" + uid + "/memberships", "id", uid},
		// Phase 3: case-scoped litigation routes resolve {id} despite sharing the
		// /legal-cases/{id} prefix with the Phase-2 LegalCase block, and the nested
		// pleading/defendant sub-resources resolve their own keys.
		{"GET", "/api/v1/lex/legal-cases/" + uid + "/pleadings", "id", uid},
		{"GET", "/api/v1/lex/legal-cases/" + uid + "/pleadings/" + uid, "pleadingId", uid},
		{"POST", "/api/v1/lex/legal-cases/" + uid + "/defendant/" + uid + "/response-review", "defendantId", uid},
		// Phase 3: investigations + consultations resolve {id}; settlements resolve
		// {id}; the contracts review-desk resolves {id} under the shared /contracts
		// prefix without colliding with the existing /contracts/{id} routes.
		{"GET", "/api/v1/lex/investigations/" + uid, "id", uid},
		{"GET", "/api/v1/lex/consultations/" + uid, "id", uid},
		{"GET", "/api/v1/lex/settlements/" + uid, "id", uid},
		{"GET", "/api/v1/lex/contracts/" + uid + "/review-desk", "id", uid},
		{"GET", "/api/v1/watheeq/matters/" + uid + "/timeline", "id", uid},
		// Phase 4: the static /integrations/health must NOT shadow /integrations/{id},
		// and /integrations/{id}/health resolves {id}; the inbox /{id}/read resolves {id}.
		{"GET", "/api/v1/lex/integrations/" + uid, "id", uid},
		{"GET", "/api/v1/lex/integrations/" + uid + "/health", "id", uid},
		// Integration Platform framework: the static /integrations/schema/{kind} must
		// NOT shadow /integrations/{id}; the /{id}/test|sync|sync-runs verbs resolve {id}.
		{"POST", "/api/v1/lex/integrations/" + uid + "/test", "id", uid},
		{"POST", "/api/v1/lex/integrations/" + uid + "/sync", "id", uid},
		{"GET", "/api/v1/lex/integrations/" + uid + "/sync-runs", "id", uid},
		{"GET", "/api/v1/lex/integrations/schema/hr", "kind", "hr"},
		{"POST", "/api/v1/lex/notifications/inbox/" + uid + "/read", "id", uid},
	}
	for _, c := range cases {
		rctx := chi.NewRouteContext()
		if !r.Match(rctx, c.method, c.path) {
			t.Fatalf("no route matched %s %s", c.method, c.path)
		}
		if got := rctx.URLParam(c.key); got != c.want {
			t.Fatalf("%s %s: URLParam(%q)=%q, want %q (chi param-key collision at /requests/{...})", c.method, c.path, c.key, got, c.want)
		}
	}
}

func TestFullLexBuildOutDomainRouteAnchorsAreMirrored(t *testing.T) {
	logger := zerolog.Nop()
	deps := testRouteDependencies(logger)

	r := chi.NewRouter()
	RegisterRoutes(r, deps)
	registered := registeredRoutes(t, r)

	for _, prefix := range []string{"/api/v1/lex", "/api/v1/watheeq"} {
		for _, route := range lexBuildOutDomainRoutes {
			key := route.method + " " + prefix + route.path
			if !registered[key] {
				t.Errorf("%s domain route not mirrored on %s: %s", route.domain, prefix, key)
			}
		}
	}
}

func TestFullLexBuildOutPublicProtectedAndAdminRouteSurfaces(t *testing.T) {
	logger := zerolog.Nop()
	deps := testRouteDependencies(logger)

	r := chi.NewRouter()
	RegisterRoutes(r, deps)

	want := []string{
		// Public CAP-002 webhook, intentionally outside JWT middleware.
		"POST /api/v1/lex/intake/email/webhook",
		"POST /api/v1/watheeq/intake/email/webhook",

		// CAP-152 pre-auth SSO login, intentionally outside JWT middleware (login is
		// pre-session). Mirrored on both suite prefixes.
		"GET /api/v1/lex/auth/sso/initiate",
		"GET /api/v1/lex/auth/sso/callback",
		"POST /api/v1/lex/auth/sso/callback",
		"GET /api/v1/lex/auth/sso/discover",
		"GET /api/v1/watheeq/auth/sso/initiate",

		// Protected requester/provider surfaces.
		"POST /api/v1/lex/service-catalog/eligibility-check",
		"GET /api/v1/lex/service-catalog",
		"POST /api/v1/lex/intake/submit",
		"GET /api/v1/lex/intake/messages/{id}",
		"POST /api/v1/lex/sla/clocks",
		// WS9 operations-board computed clock view; literal precedes /sla/clocks/{id}.
		"GET /api/v1/lex/sla/clocks",
		"GET /api/v1/lex/sla/requests/{requestId}/clock",
		"POST /api/v1/lex/requests/{requestId}/execution/confirm-completeness",
		"POST /api/v1/lex/requests/{requestId}/execution/delivery-confirmation/{confirmationId}/respond",
		"POST /api/v1/watheeq/service-catalog/eligibility-check",
		"POST /api/v1/watheeq/intake/submit",
		"GET /api/v1/watheeq/sla/requests/{requestId}/clock",
		"GET /api/v1/watheeq/requests/{requestId}/execution",

		// Admin/configuration surfaces for the same Phase 1 modules.
		"POST /api/v1/lex/service-catalog",
		"DELETE /api/v1/lex/service-catalog/{id}",
		"POST /api/v1/lex/intake/mailboxes",
		"DELETE /api/v1/lex/intake/mailboxes/{id}",
		"POST /api/v1/lex/sla/targets",
		"PATCH /api/v1/lex/sla/targets/{id}",
		"DELETE /api/v1/lex/sla/targets/{id}",
		"POST /api/v1/lex/sla/outbox/dispatch",
		"DELETE /api/v1/watheeq/service-catalog/{id}",
		"POST /api/v1/watheeq/intake/mailboxes",
		"PATCH /api/v1/watheeq/sla/targets/{id}",

		// Phase 2: Litigation Case Management + Case Classification taxonomy.
		"POST /api/v1/lex/legal-cases",
		"GET /api/v1/lex/legal-cases/intake/tasks",
		"GET /api/v1/lex/legal-cases/{id}",
		"POST /api/v1/lex/legal-cases/{id}/intake/{workflowInstanceID}/tasks/{taskID}/decision",
		"PUT /api/v1/lex/legal-cases/{id}/parties/{partyId}",
		// WS9 bulk party/task create; literal /bulk precedes the {partyId}/{taskId} wildcards.
		"POST /api/v1/lex/legal-cases/{id}/parties/bulk",
		"POST /api/v1/lex/legal-cases/{id}/tasks/bulk",
		"GET /api/v1/lex/case-classifications/tree",
		"GET /api/v1/lex/case-classifications/{id}/cascade",
		"GET /api/v1/lex/case-classifications/{id}/audit",
		"GET /api/v1/lex/org-entities/{id}/memberships",
		"POST /api/v1/lex/case-classifications/reorder",
		"POST /api/v1/lex/case-classifications/bulk",
		"POST /api/v1/watheeq/legal-cases",
		"GET /api/v1/watheeq/legal-cases/intake/tasks",
		"GET /api/v1/watheeq/case-classifications/tree",

		// Phase 3: Plaintiff/Defendant litigation flows (case-scoped).
		"POST /api/v1/lex/legal-cases/{id}/pleadings",
		"POST /api/v1/lex/legal-cases/{id}/pleadings/{pleadingId}/submit",
		"POST /api/v1/lex/legal-cases/{id}/pleadings/{pleadingId}/approvals/{workflowInstanceID}/tasks/{taskID}/decision",
		"POST /api/v1/lex/legal-cases/{id}/hearings/{hearingId}/reports",
		"POST /api/v1/lex/legal-cases/{id}/experts",
		"POST /api/v1/lex/legal-cases/{id}/judgments/{judgmentId}/study",
		"POST /api/v1/lex/legal-cases/{id}/defendant/{defendantId}/response-review",

		// Phase 3: Investigations.
		"POST /api/v1/lex/investigations",
		"POST /api/v1/lex/investigations/{id}/results",
		"POST /api/v1/lex/investigations/{id}/reminders",
		"POST /api/v1/lex/investigations/{id}/approval/start",
		"POST /api/v1/lex/investigations/{id}/approval/{workflowInstanceId}/tasks/{taskId}/decision",

		// Phase 3: Consultations.
		"POST /api/v1/lex/consultations",
		"GET /api/v1/lex/consultations/count",
		"POST /api/v1/lex/consultations/{id}/respond",
		"POST /api/v1/lex/consultations/{id}/approval/start",

		// Phase 3: Case Timelines + Settlements.
		"GET /api/v1/lex/matters/{id}/timeline",
		"POST /api/v1/lex/matters/{id}/delay-events/{eventId}/resolve",
		"POST /api/v1/lex/settlements",
		"POST /api/v1/lex/settlements/{id}/close",
		"POST /api/v1/lex/settlements/{id}/workflows/{workflowId}/tasks/{taskId}/decision",

		// Phase 3: Contracts review-desk (mirrored on watheeq).
		"GET /api/v1/lex/contracts/{id}/review-desk",
		"POST /api/v1/lex/contracts/{id}/review-desk/intake",
		"POST /api/v1/lex/contracts/{id}/review-desk/recommendation",
		"POST /api/v1/watheeq/contracts/{id}/review-desk/intake",

		// Phase 4: Reporting & KPIs. /reports/contracts-analytics is the new analytics
		// variant; /reports/contracts stays the existing contract CSV export.
		"GET /api/v1/lex/reports/cases",
		"GET /api/v1/lex/reports/investigations",
		"GET /api/v1/lex/reports/contracts-analytics",
		"GET /api/v1/lex/kpis/sla-compliance",
		"GET /api/v1/lex/dashboard/cases-control",
		"GET /api/v1/lex/dashboard/legal-affairs",
		"GET /api/v1/watheeq/reports/cases",
		"GET /api/v1/watheeq/reports/investigations",
		"GET /api/v1/watheeq/dashboard/cases-control",

		// Ad-hoc manager tasks: manager creates, assignee executes, director reviews.
		"GET /api/v1/lex/manager-tasks",
		"POST /api/v1/lex/manager-tasks",
		"GET /api/v1/lex/manager-tasks/{id}",
		"POST /api/v1/lex/manager-tasks/{id}/start",
		"POST /api/v1/lex/manager-tasks/{id}/submit",
		"POST /api/v1/lex/manager-tasks/{id}/decision",
		"GET /api/v1/watheeq/manager-tasks",
		"POST /api/v1/watheeq/manager-tasks/{id}/decision",

		// Phase 4: Notification triggers + in-app inbox.
		"GET /api/v1/lex/notifications/inbox",
		"GET /api/v1/lex/notifications/inbox/counts",
		"POST /api/v1/lex/notifications/inbox/read-all",
		"POST /api/v1/lex/notifications/inbox/{id}/read",
		"PUT /api/v1/lex/notifications/subscriptions",

		// Phase 4: Cross-cutting (document FTS, attachment policies, integrations).
		"POST /api/v1/lex/documents/search",
		"POST /api/v1/lex/documents/{id}/extracted-text",
		"POST /api/v1/lex/documents/{id}/editor/session",
		"POST /api/v1/lex/documents/{id}/editor/callback",
		"POST /api/v1/lex/documents/{id}/editor/lock",
		"DELETE /api/v1/lex/documents/{id}/editor/lock",
		"GET /api/v1/lex/documents/{id}/editor/audit",
		"POST /api/v1/lex/documents/{id}/editor/preflight",
		"POST /api/v1/lex/documents/{id}/editor/snapshot",
		"GET /api/v1/lex/documents/{id}/editor/negotiation-room",
		"PUT /api/v1/lex/documents/{id}/editor/negotiation-room",
		"POST /api/v1/lex/documents/{id}/editor/negotiation-room/messages",
		"GET /api/v1/lex/documents/{id}/editor/playbook-enforcement",
		"POST /api/v1/lex/documents/{id}/editor/playbook-enforcement",
		"GET /api/v1/lex/documents/{id}/editor/navigator",
		"GET /api/v1/lex/documents/{id}/editor/terms-cross-references",
		"POST /api/v1/lex/documents/{id}/editor/terms-cross-references",
		"GET /api/v1/lex/documents/{id}/editor/section-assignments",
		"PUT /api/v1/lex/documents/{id}/editor/section-assignments",
		"POST /api/v1/lex/documents/{id}/editor/guest-review-link",
		"GET /api/v1/lex/documents/{id}/editor/guest-review-links",
		"POST /api/v1/lex/documents/{id}/editor/guest-review-links",
		"DELETE /api/v1/lex/documents/{id}/editor/guest-review-links/{linkId}",
		"GET /api/v1/lex/documents/{id}/editor/legal-issues",
		"POST /api/v1/lex/documents/{id}/editor/legal-issues",
		"PATCH /api/v1/lex/documents/{id}/editor/legal-issues/{issueId}",
		"POST /api/v1/lex/documents/{id}/editor/legal-issues/{issueId}/resolve",
		"GET /api/v1/lex/documents/{id}/editor/signature-readiness",
		"POST /api/v1/lex/documents/{id}/editor/signature-readiness",
		"POST /api/v1/lex/documents/{id}/editor/clause-ai-actions",
		"GET /api/v1/lex/documents/{id}/editor/health",
		"GET /api/v1/lex/documents/{id}/editor/health-score",
		"POST /api/v1/lex/documents/{id}/editor/health-score",
		"GET /api/v1/lex/documents/{id}/editor/privileged-controls",
		"PUT /api/v1/lex/documents/{id}/editor/privileged-controls",
		"POST /api/v1/lex/documents/{id}/editor/privileged-controls/request",
		"GET /api/v1/lex/attachment-policies",
		"POST /api/v1/lex/attachment-policies/evaluate",
		"DELETE /api/v1/lex/attachment-policies/{id}",
		"GET /api/v1/lex/integrations",
		"GET /api/v1/lex/integrations/health",
		"GET /api/v1/lex/integrations/{id}/health",
		"GET /api/v1/lex/integrations/schema/{kind}",
		"POST /api/v1/lex/integrations/{id}/test",
		"POST /api/v1/lex/integrations/{id}/sync",
		"GET /api/v1/lex/integrations/{id}/sync-runs",
		"PUT /api/v1/watheeq/integrations/{id}",
	}

	registered := registeredRoutes(t, r)

	for _, key := range want {
		if !registered[key] {
			t.Errorf("lex build-out route not registered: %s", key)
		}
	}

	for _, path := range []string{
		"/api/v1/lex/intake/email/webhook",
		"/api/v1/watheeq/intake/email/webhook",
	} {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{"))
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s without bearer token returned %d, want 400 from public webhook body validation", path, rec.Code)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/lex/service-catalog", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("protected service-catalog route without bearer token returned %d, want 401", rec.Code)
	}

	for _, prefix := range []string{"/api/v1/lex", "/api/v1/watheeq"} {
		for _, route := range lexBuildOutDomainRoutes {
			path := concreteRoute(prefix + route.path)
			req := httptest.NewRequest(route.method, path, nil)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("%s domain protected route without bearer token returned %d, want 401: %s %s", route.domain, rec.Code, route.method, path)
			}
		}
	}
}

func TestInvestigationLifecycleRouteAuthorizationSeparation(t *testing.T) {
	logger := zerolog.Nop()
	deps := testRouteDependencies(logger)
	jwtMgr, err := auth.NewJWTManager(appconfig.AuthConfig{
		JWTIssuer:       "investigation-lifecycle-test",
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewJWTManager failed: %v", err)
	}
	deps.JWTManager = jwtMgr
	redisServer := miniredis.RunT(t)
	deps.Redis = redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	defer deps.Redis.Close()
	// Reaching ABAC proves the route-level RBAC admitted the request without
	// invoking the nil service used by this composition test.
	deps.ABACMW = func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		})
	}

	roles := map[string][]string{
		"investigation_lifecycle_editor":   {auth.PermLexInvestigationEdit},
		"investigation_lifecycle_approver": {auth.PermLexInvestigationApprove},
		"investigation_lifecycle_closer":   {auth.PermLexInvestigationClose},
	}
	for role, permissions := range roles {
		previous, existed := auth.RolePermissions[role]
		auth.RolePermissions[role] = permissions
		t.Cleanup(func() {
			if existed {
				auth.RolePermissions[role] = previous
			} else {
				delete(auth.RolePermissions, role)
			}
		})
	}

	router := chi.NewRouter()
	RegisterRoutes(router, deps)
	recordID := "11111111-1111-1111-1111-111111111111"
	workflowID := "22222222-2222-2222-2222-222222222222"
	taskID := "33333333-3333-3333-3333-333333333333"

	serve := func(role, path string) int {
		t.Helper()
		pair, tokenErr := jwtMgr.GenerateTokenPair(uuid.NewString(), "tenant-1", role+"@example.com", []string{role}, uuid.NewString())
		if tokenErr != nil {
			t.Fatalf("GenerateTokenPair(%s): %v", role, tokenErr)
		}
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{}"))
		req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}

	startPath := "/api/v1/lex/investigations/" + recordID + "/approval/start"
	if got := serve("investigation_lifecycle_editor", startPath); got != http.StatusTeapot {
		t.Errorf("editor approval submission = %d, want ABAC sentinel 418", got)
	}
	if got := serve("investigation_lifecycle_approver", startPath); got != http.StatusForbidden {
		t.Errorf("approve-only actor approval submission = %d, want 403", got)
	}

	decisionPath := "/api/v1/lex/investigations/" + recordID + "/approval/" + workflowID + "/tasks/" + taskID + "/decision"
	if got := serve("investigation_lifecycle_approver", decisionPath); got != http.StatusTeapot {
		t.Errorf("approver decision route = %d, want ABAC sentinel 418", got)
	}
	if got := serve("investigation_lifecycle_editor", decisionPath); got != http.StatusForbidden {
		t.Errorf("editor decision route = %d, want 403", got)
	}

	statusPath := "/api/v1/lex/investigations/" + recordID + "/status"
	if got := serve("investigation_lifecycle_closer", statusPath); got != http.StatusTeapot {
		t.Errorf("close-only actor status route = %d, want ABAC sentinel 418", got)
	}
	if got := serve("investigation_lifecycle_editor", statusPath); got != http.StatusTeapot {
		t.Errorf("editor status route = %d, want ABAC sentinel 418", got)
	}
}

func TestProtectedRoutesUseAuthTenantRateLimitRBACAndABAC(t *testing.T) {
	logger := zerolog.Nop()
	deps := testRouteDependencies(logger)

	jwtMgr, err := auth.NewJWTManager(appconfig.AuthConfig{
		JWTIssuer:       "test-issuer",
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewJWTManager failed: %v", err)
	}
	token, err := jwtMgr.GenerateTokenPair("user-1", "tenant-1", "legal@example.com", []string{"tenant_admin"}, "session-1")
	if err != nil {
		t.Fatalf("GenerateTokenPair failed: %v", err)
	}
	noTenantToken, err := jwtMgr.GenerateTokenPair("user-2", "", "no-tenant@example.com", []string{"tenant_admin"}, "session-2")
	if err != nil {
		t.Fatalf("GenerateTokenPair(no tenant) failed: %v", err)
	}

	deps.JWTManager = jwtMgr
	redisServer := miniredis.RunT(t)
	deps.Redis = redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	defer deps.Redis.Close()
	deps.ABACMW = func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		})
	}

	r := chi.NewRouter()
	RegisterRoutes(r, deps)

	for _, path := range []string{
		"/api/v1/lex/service-catalog",
		"/api/v1/watheeq/service-catalog",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token.AccessToken)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusTeapot {
			t.Fatalf("%s returned %d, want ABAC sentinel %d", path, rec.Code, http.StatusTeapot)
		}
		if got := rec.Header().Get("X-RateLimit-Limit"); got != "60" {
			t.Fatalf("%s X-RateLimit-Limit = %q, want 60", path, got)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/lex/service-catalog", nil)
	req.Header.Set("Authorization", "Bearer "+noTenantToken.AccessToken)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("protected route with valid token but no tenant returned %d, want 400 from TenantGuard", rec.Code)
	}
}

func TestCaseControlDashboardRequiresBothDomainViewPermissions(t *testing.T) {
	logger := zerolog.Nop()
	deps := testRouteDependencies(logger)

	jwtMgr, err := auth.NewJWTManager(appconfig.AuthConfig{
		JWTIssuer:       "case-control-test",
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewJWTManager failed: %v", err)
	}
	deps.JWTManager = jwtMgr
	redisServer := miniredis.RunT(t)
	deps.Redis = redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	defer deps.Redis.Close()
	// The sentinel proves the full RBAC intersection passed without invoking the
	// nil-service test handler.
	deps.ABACMW = func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		})
	}

	testRoles := map[string][]string{
		"case_control_report_only": {auth.PermLexReportRead},
		"case_control_coarse_read": {auth.PermLexRead},
		"case_control_case_only":   {auth.PermLexCaseView},
		"case_control_both":        {auth.PermLexCaseView, auth.PermLexInvestigationView},
		"case_control_wildcard":    {"lex:*"},
	}
	for role, permissions := range testRoles {
		previous, existed := auth.RolePermissions[role]
		auth.RolePermissions[role] = permissions
		t.Cleanup(func() {
			if existed {
				auth.RolePermissions[role] = previous
			} else {
				delete(auth.RolePermissions, role)
			}
		})
	}

	router := chi.NewRouter()
	RegisterRoutes(router, deps)

	tests := []struct {
		role string
		want int
	}{
		{role: "case_control_report_only", want: http.StatusForbidden},
		{role: "case_control_coarse_read", want: http.StatusForbidden},
		{role: "case_control_case_only", want: http.StatusForbidden},
		{role: "case_control_both", want: http.StatusTeapot},
		{role: "case_control_wildcard", want: http.StatusTeapot},
	}
	for i, tc := range tests {
		pair, err := jwtMgr.GenerateTokenPair(
			"user-"+tc.role,
			"tenant-1",
			tc.role+"@example.com",
			[]string{tc.role},
			"session-"+tc.role,
		)
		if err != nil {
			t.Fatalf("GenerateTokenPair(%s) failed: %v", tc.role, err)
		}
		for _, prefix := range []string{"/api/v1/lex", "/api/v1/watheeq"} {
			req := httptest.NewRequest(http.MethodGet, prefix+"/dashboard/cases-control", nil)
			req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Errorf("test %d %s %s returned %d, want %d: %s", i, tc.role, prefix, rec.Code, tc.want, rec.Body.String())
			}
		}
	}
}

func testRouteDependencies(logger zerolog.Logger) RouteDependencies {
	return RouteDependencies{
		Contract:              NewContractHandler(nil, nil, logger),
		Clause:                NewClauseHandler(nil, logger),
		Document:              NewDocumentHandler(nil, logger),
		DocumentEditor:        NewDocumentEditorHandler(nil, logger),
		Compliance:            NewComplianceHandler(nil, logger),
		Library:               NewLibraryHandler(nil, logger),
		Matter:                NewMatterHandler(nil, logger),
		Obligation:            NewObligationHandler(nil, logger),
		Signature:             NewSignatureHandler(nil, logger),
		Playbook:              NewPlaybookHandler(nil, logger),
		Dashboard:             NewDashboardHandler(nil, logger),
		WorkingCalendar:       NewWorkingCalendarHandler(nil, logger),
		OrgEntity:             NewOrgEntityHandler(nil, logger),
		LegalRequest:          NewLegalRequestHandler(nil, logger),
		RequestApprovalPolicy: NewRequestApprovalPolicyHandler(nil, logger),
		RequestApproval:       NewRequestApprovalHandler(nil, logger),
		ServiceCatalog:        NewServiceCatalogHandler(nil, logger),
		Intake:                NewIntakeHandler(nil, logger),
		SLA:                   NewSLAHandler(nil, logger),
		Execution:             NewExecutionHandler(nil, nil, logger),
		LegalCase:             NewLegalCaseHandler(nil, nil, logger),
		CaseClassification:    NewCaseClassificationHandler(nil, logger),
		Litigation:            NewLitigationHandler(nil, nil, nil, logger),
		Investigation:         NewInvestigationHandler(nil, logger),
		Consultation:          NewConsultationHandler(nil, nil, logger),
		CaseTimeline:          NewCaseTimelineHandler(nil, logger),
		Settlement:            NewSettlementHandler(nil, logger),
		ContractReviewDesk:    NewContractReviewDeskHandler(nil, logger),
		Reporting:             NewReportingHandler(nil, logger),
		ManagerTask:           NewManagerTaskHandler(nil, logger),
		Notifications:         NewNotificationHandler(nil, logger),
		AttachmentPolicy:      NewAttachmentPolicyHandler(nil, logger),
		DocumentSearch:        NewDocumentSearchHandler(nil, logger),
		Integration:           NewIntegrationHandler(nil, logger),
		SSO:                   NewSSOHandler(service.NewLexSSOLoginService(nil, nil, logger), "", logger),
		RateLimitPerMin:       60,
	}
}

func registeredRoutes(t *testing.T, r chi.Router) map[string]bool {
	t.Helper()
	registered := map[string]bool{}
	if err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		registered[method+" "+strings.TrimSuffix(route, "/")] = true
		return nil
	}); err != nil {
		t.Fatalf("chi.Walk error = %v", err)
	}
	return registered
}

func concreteRoute(route string) string {
	replacements := map[string]string{
		"{id}":                 "11111111-1111-1111-1111-111111111111",
		"{requestId}":          "22222222-2222-2222-2222-222222222222",
		"{confirmationId}":     "33333333-3333-3333-3333-333333333333",
		"{defendantId}":        "44444444-4444-4444-4444-444444444444",
		"{workflowInstanceId}": "55555555-5555-5555-5555-555555555555",
		"{taskId}":             "66666666-6666-6666-6666-666666666666",
	}
	for from, to := range replacements {
		route = strings.ReplaceAll(route, from, to)
	}
	return route
}
