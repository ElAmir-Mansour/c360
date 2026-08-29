package handler

import (
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
)

func TestDocumentEditorRouteShapeScaffold(t *testing.T) {
	r := chi.NewRouter()
	RegisterRoutes(r, testRouteDependencies(zerolog.Nop()))
	registered := registeredRoutes(t, r)

	expected := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/documents/{id}/editor/session"},
		{http.MethodPost, "/documents/{id}/editor/callback"},
		{http.MethodPost, "/documents/{id}/editor/lock"},
		{http.MethodDelete, "/documents/{id}/editor/lock"},
		{http.MethodGet, "/documents/{id}/editor/audit"},
		{http.MethodPost, "/documents/{id}/editor/preflight"},
		{http.MethodPost, "/documents/{id}/editor/snapshot"},
		{http.MethodGet, "/documents/{id}/editor/negotiation-room"},
		{http.MethodPut, "/documents/{id}/editor/negotiation-room"},
		{http.MethodPost, "/documents/{id}/editor/negotiation-room/messages"},
		{http.MethodGet, "/documents/{id}/editor/playbook-enforcement"},
		{http.MethodPost, "/documents/{id}/editor/playbook-enforcement"},
		{http.MethodGet, "/documents/{id}/editor/navigator"},
		{http.MethodGet, "/documents/{id}/editor/terms-cross-references"},
		{http.MethodPost, "/documents/{id}/editor/terms-cross-references"},
		{http.MethodGet, "/documents/{id}/editor/section-assignments"},
		{http.MethodPut, "/documents/{id}/editor/section-assignments"},
		{http.MethodPost, "/documents/{id}/editor/guest-review-link"},
		{http.MethodGet, "/documents/{id}/editor/guest-review-links"},
		{http.MethodPost, "/documents/{id}/editor/guest-review-links"},
		{http.MethodDelete, "/documents/{id}/editor/guest-review-links/{linkId}"},
		{http.MethodGet, "/documents/{id}/editor/legal-issues"},
		{http.MethodPost, "/documents/{id}/editor/legal-issues"},
		{http.MethodPatch, "/documents/{id}/editor/legal-issues/{issueId}"},
		{http.MethodPost, "/documents/{id}/editor/legal-issues/{issueId}/resolve"},
		{http.MethodGet, "/documents/{id}/editor/signature-readiness"},
		{http.MethodPost, "/documents/{id}/editor/signature-readiness"},
		{http.MethodPost, "/documents/{id}/editor/clause-ai-actions"},
		{http.MethodGet, "/documents/{id}/editor/health"},
		{http.MethodGet, "/documents/{id}/editor/health-score"},
		{http.MethodPost, "/documents/{id}/editor/health-score"},
		{http.MethodGet, "/documents/{id}/editor/privileged-controls"},
		{http.MethodPut, "/documents/{id}/editor/privileged-controls"},
		{http.MethodPost, "/documents/{id}/editor/privileged-controls/request"},
		{http.MethodGet, "/documents/{id}/editor/provider-events"},
		{http.MethodPost, "/documents/{id}/editor/provider-events"},
		{http.MethodGet, "/documents/{id}/editor/guest-review-links/{linkId}/portal"},
		{http.MethodPost, "/documents/{id}/editor/guest-review-links/{linkId}/portal/comments"},
		{http.MethodGet, "/documents/{id}/editor/tasks"},
		{http.MethodPost, "/documents/{id}/editor/tasks"},
		{http.MethodPatch, "/documents/{id}/editor/tasks/{taskId}"},
		{http.MethodGet, "/documents/{id}/editor/clause-anchors"},
		{http.MethodPut, "/documents/{id}/editor/clause-anchors"},
		{http.MethodPost, "/documents/{id}/editor/clause-anchors/extract"},
		{http.MethodGet, "/documents/{id}/editor/redline-packages"},
		{http.MethodPost, "/documents/{id}/editor/redline-packages"},
		{http.MethodGet, "/documents/{id}/editor/approval-matrix"},
		{http.MethodPut, "/documents/{id}/editor/approval-matrix"},
		{http.MethodPost, "/documents/{id}/editor/approval-matrix/requests"},
		{http.MethodPost, "/documents/{id}/editor/approval-requests"},
		{http.MethodGet, "/documents/{id}/editor/compare"},
		{http.MethodPost, "/documents/{id}/editor/compare"},
		{http.MethodGet, "/documents/{id}/editor/compare-workspace"},
		{http.MethodPost, "/documents/{id}/editor/compare-workspace"},
		{http.MethodGet, "/documents/{id}/editor/collaboration-inbox"},
		{http.MethodPost, "/documents/{id}/editor/collaboration-inbox/{itemId}/read"},
		{http.MethodGet, "/documents/{id}/editor/playbook-rules"},
		{http.MethodPost, "/documents/{id}/editor/playbook-rules"},
		{http.MethodPut, "/documents/{id}/editor/playbook-rules"},
		{http.MethodGet, "/documents/{id}/editor/defined-term-repairs"},
		{http.MethodPost, "/documents/{id}/editor/defined-term-repairs"},
		{http.MethodGet, "/documents/{id}/editor/terms-cross-references/repairs"},
		{http.MethodPost, "/documents/{id}/editor/terms-cross-references/repair"},
		{http.MethodGet, "/documents/{id}/editor/term-repairs"},
		{http.MethodPost, "/documents/{id}/editor/term-repairs"},
		{http.MethodGet, "/documents/{id}/editor/citations"},
		{http.MethodPost, "/documents/{id}/editor/citations"},
		{http.MethodGet, "/documents/{id}/editor/citation-bindings"},
		{http.MethodPost, "/documents/{id}/editor/citation-bindings"},
		{http.MethodGet, "/documents/{id}/editor/evidence-bindings"},
		{http.MethodPost, "/documents/{id}/editor/evidence-bindings"},
		{http.MethodGet, "/documents/{id}/editor/ai-change-safety"},
		{http.MethodPost, "/documents/{id}/editor/ai-change-safety"},
		{http.MethodPut, "/documents/{id}/editor/ai-change-safety"},
		{http.MethodGet, "/documents/{id}/editor/offline-recovery"},
		{http.MethodPost, "/documents/{id}/editor/offline-recovery"},
		{http.MethodPut, "/documents/{id}/editor/offline-recovery"},
		{http.MethodPost, "/documents/{id}/editor/offline-recovery/restore"},
		{http.MethodGet, "/documents/{id}/editor/analytics"},
	}

	for _, prefix := range []string{"/api/v1/lex", "/api/v1/watheeq"} {
		for _, route := range expected {
			key := route.method + " " + prefix + route.path
			if !registered[key] {
				t.Errorf("document editor route not registered: %s", key)
			}
		}
	}
}

func TestDocumentEditorGuestPortalTokenRoutes(t *testing.T) {
	r := chi.NewRouter()
	RegisterRoutes(r, testRouteDependencies(zerolog.Nop()))
	registered := registeredRoutes(t, r)

	expected := []string{
		"GET /api/v1/lex/editor/guest-portal/{token}",
		"POST /api/v1/lex/editor/guest-portal/{token}/session",
		"POST /api/v1/lex/editor/guest-portal/{token}/comments",
		"GET /api/v1/watheeq/editor/guest-portal/{token}",
		"POST /api/v1/watheeq/editor/guest-portal/{token}/session",
		"POST /api/v1/watheeq/editor/guest-portal/{token}/comments",
	}
	for _, key := range expected {
		if !registered[key] {
			t.Errorf("document editor guest portal route not registered: %s", key)
		}
	}
}

func TestDocumentEditorNextWaveRouteContracts(t *testing.T) {
	r := chi.NewRouter()
	RegisterRoutes(r, testRouteDependencies(zerolog.Nop()))
	registered := registeredRoutes(t, r)

	expected := []struct {
		method string
		path   string
	}{
		// These handlers/client affordances exist in the next-wave editor surface,
		// so RegisterRoutes should expose explicit contracts for them as well.
		{http.MethodPost, "/documents/{id}/editor/guest-review-links/{linkId}/portal/validate"},
		{http.MethodGet, "/documents/{id}/editor/redline-packages"},
		{http.MethodGet, "/documents/{id}/editor/compare-workspace"},
		{http.MethodGet, "/documents/{id}/editor/terms-cross-references/repairs"},
	}

	for _, prefix := range []string{"/api/v1/lex", "/api/v1/watheeq"} {
		for _, route := range expected {
			key := route.method + " " + prefix + route.path
			if !registered[key] {
				t.Errorf("next-wave document editor contract route not registered: %s", key)
			}
		}
	}
}

func TestDocumentEditorRoutesResolveDocumentID(t *testing.T) {
	r := chi.NewRouter()
	RegisterRoutes(r, testRouteDependencies(zerolog.Nop()))

	const documentID = "11111111-1111-1111-1111-111111111111"
	cases := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/documents/" + documentID + "/editor/session"},
		{http.MethodPost, "/documents/" + documentID + "/editor/callback"},
		{http.MethodPost, "/documents/" + documentID + "/editor/lock"},
		{http.MethodDelete, "/documents/" + documentID + "/editor/lock"},
		{http.MethodGet, "/documents/" + documentID + "/editor/audit"},
		{http.MethodPost, "/documents/" + documentID + "/editor/preflight"},
		{http.MethodPost, "/documents/" + documentID + "/editor/snapshot"},
	}

	for _, prefix := range []string{"/api/v1/lex", "/api/v1/watheeq"} {
		for _, tc := range cases {
			path := prefix + tc.path
			rctx := chi.NewRouteContext()
			if !r.Match(rctx, tc.method, path) {
				t.Fatalf("no route matched %s %s", tc.method, path)
			}
			if got := rctx.URLParam("id"); got != documentID {
				t.Fatalf("%s %s URLParam(id) = %q, want %q", tc.method, path, got, documentID)
			}
		}
	}
}
