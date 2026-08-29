package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
)

// TestPhase0RoutesCompose proves the Phase 0 legal-affairs foundation routes
// are registered under both the /lex and /watheeq prefixes.
func TestPhase0RoutesCompose(t *testing.T) {
	logger := zerolog.Nop()
	deps := RouteDependencies{
		Contract:              NewContractHandler(nil, nil, logger),
		Clause:                NewClauseHandler(nil, logger),
		Document:              NewDocumentHandler(nil, logger),
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
		RateLimitPerMin:       60,
	}

	r := chi.NewRouter()
	RegisterRoutes(r, deps)

	want := []string{
		"POST /api/v1/lex/working-calendars",
		"GET /api/v1/lex/working-calendars",
		"GET /api/v1/lex/working-calendars/{id}",
		"PUT /api/v1/lex/working-calendars/{id}",
		"DELETE /api/v1/lex/working-calendars/{id}",
		"POST /api/v1/lex/working-calendars/{id}/holidays",
		"DELETE /api/v1/lex/working-calendars/{id}/holidays/{holidayId}",
		"POST /api/v1/lex/org-entities",
		"GET /api/v1/lex/org-entities",
		"GET /api/v1/lex/org-entities/lookup",
		"GET /api/v1/lex/org-entities/audit",
		"GET /api/v1/lex/org-entities/platform-units",
		"GET /api/v1/lex/org-entities/{id}/audit",
		"GET /api/v1/lex/org-entities/{id}/escalation",
		"POST /api/v1/lex/org-entities/{id}/roles",
		"DELETE /api/v1/lex/org-entities/{id}/roles/{roleKey}",
		"GET /api/v1/lex/org-entities/{id}",
		"PUT /api/v1/lex/org-entities/{id}",
		"DELETE /api/v1/lex/org-entities/{id}",
		"POST /api/v1/lex/legal-requests",
		"GET /api/v1/lex/legal-requests",
		"GET /api/v1/lex/legal-requests/{id}/priority-changes",
		"GET /api/v1/lex/legal-requests/{id}/audit",
		"POST /api/v1/lex/legal-requests/{id}/submit",
		"POST /api/v1/lex/legal-requests/{id}/priority",
		"GET /api/v1/lex/legal-requests/{id}",
		"PUT /api/v1/lex/legal-requests/{id}",
		"DELETE /api/v1/lex/legal-requests/{id}",
		"GET /api/v1/lex/request-approval/policies/templates",
		"POST /api/v1/lex/request-approval/policies/templates",
		"GET /api/v1/lex/request-approval/policies/templates/{id}",
		"PATCH /api/v1/lex/request-approval/policies/templates/{id}",
		"DELETE /api/v1/lex/request-approval/policies/templates/{id}",
		"POST /api/v1/lex/request-approval/policies/templates/{id}/instantiate",
		"POST /api/v1/lex/request-approval/policies/conflict-check",
		"GET /api/v1/lex/request-approval/policies",
		"POST /api/v1/lex/request-approval/policies",
		"GET /api/v1/lex/request-approval/policies/recommend",
		"GET /api/v1/lex/request-approval/policies/{id}/versions",
		"GET /api/v1/lex/request-approval/policies/{id}/versions/{version}",
		"POST /api/v1/lex/request-approval/policies/{id}/versions/{version}/restore",
		"GET /api/v1/lex/request-approval/policies/{id}/audit",
		"GET /api/v1/lex/request-approval/policies/{id}",
		"PATCH /api/v1/lex/request-approval/policies/{id}",
		"POST /api/v1/lex/request-approval/policies/{id}/archive",
		"DELETE /api/v1/lex/request-approval/policies/{id}",
		"POST /api/v1/lex/requests/{id}/approval/start",
		"POST /api/v1/lex/requests/{id}/approval/{workflowInstanceID}/tasks/{taskID}/decision",
		"GET /api/v1/lex/requests/{id}/approval/tasks",
		"GET /api/v1/lex/requests/{id}/approval",
		"GET /api/v1/watheeq/working-calendars",
		"GET /api/v1/watheeq/org-entities/lookup",
		"GET /api/v1/watheeq/legal-requests",
		"GET /api/v1/watheeq/request-approval/policies/recommend",
		"POST /api/v1/watheeq/requests/{id}/approval/start",
	}

	registered := map[string]bool{}
	if err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		registered[method+" "+strings.TrimSuffix(route, "/")] = true
		return nil
	}); err != nil {
		t.Fatalf("chi.Walk error = %v", err)
	}

	for _, key := range want {
		if !registered[key] {
			t.Errorf("phase 0 route not registered: %s", key)
		}
	}
}
