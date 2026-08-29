package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
)

// =============================================================================
// Document-scoped e-archive action handler tests (Othaim PRD 14.1).
//
// Coverage: the 409 NO_ARCHIVE_CONNECTOR path (no active archiving endpoint),
// active-endpoint resolution querying kind=archiving/status=active, and the GET
// archive-status read (archived true/false from the stamped document metadata).
// The full POST invoke path is exercised end-to-end by the connector tests
// (earchive_local_test.go / earchive_connector_test.go).
// =============================================================================

type fakeEndpointLister struct {
	endpoints []model.IntegrationEndpoint
	gotKind   string
	gotStatus string
	err       error
}

func (f *fakeEndpointLister) List(_ context.Context, _ uuid.UUID, kind, status string) ([]model.IntegrationEndpoint, error) {
	f.gotKind, f.gotStatus = kind, status
	if f.err != nil {
		return nil, f.err
	}
	return f.endpoints, nil
}

type fakeArchiveDocReader struct {
	doc *model.LegalDocument
	err error
}

func (f *fakeArchiveDocReader) Get(_ context.Context, _, _ uuid.UUID) (*model.LegalDocument, error) {
	return f.doc, f.err
}

// newArchiveHandler wires a handler with a non-nil (but never-invoked for the
// tested paths) registry so the nil-guard passes.
func newArchiveHandler(endpoints archiveEndpointLister, docs archiveDocReader) *DocumentArchiveHandler {
	registry := service.NewIntegrationRegistryService(nil, nil, nil, nil, "", zerolog.Nop())
	return NewDocumentArchiveHandler(registry, endpoints, docs, zerolog.Nop())
}

// withAuthAndParam injects a tenant + user auth context and the chi {id} URL
// param onto a request so the handler's tenantAndUser + UUIDParam resolve.
func withAuthAndParam(req *http.Request, docID string) *http.Request {
	ctx := req.Context()
	ctx = auth.WithTenantID(ctx, "aaaaaaaa-0000-0000-0000-000000000001")
	ctx = auth.WithUser(ctx, &auth.ContextUser{
		ID:       "22222222-2222-2222-2222-222222222222",
		TenantID: "aaaaaaaa-0000-0000-0000-000000000001",
	})
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", docID)
	ctx = context.WithValue(ctx, chi.RouteCtxKey, rctx)
	return req.WithContext(ctx)
}

func bodyContains(body []byte, needle string) bool {
	return json.Valid(body) && containsBytes(body, needle)
}

func containsBytes(haystack []byte, needle string) bool {
	return len(needle) == 0 || indexOf(string(haystack), needle) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestArchive_NoActiveConnector_Returns409(t *testing.T) {
	endpoints := &fakeEndpointLister{endpoints: nil}
	h := newArchiveHandler(endpoints, &fakeArchiveDocReader{})

	docID := uuid.New()
	req := httptest.NewRequest("POST", "/documents/"+docID.String()+"/archive", nil)
	req = withAuthAndParam(req, docID.String())
	rr := httptest.NewRecorder()

	h.Archive(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("expected 409 NO_ARCHIVE_CONNECTOR, got %d (%s)", rr.Code, rr.Body.String())
	}
	if endpoints.gotKind != string(model.IntegrationKindArchiving) || endpoints.gotStatus != string(model.IntegrationStatusActive) {
		t.Errorf("resolver should query kind=archiving status=active, got kind=%q status=%q", endpoints.gotKind, endpoints.gotStatus)
	}
	if !bodyContains(rr.Body.Bytes(), "NO_ARCHIVE_CONNECTOR") {
		t.Errorf("body should carry NO_ARCHIVE_CONNECTOR code: %s", rr.Body.String())
	}
}

func TestArchiveStatus_ReportsArchivedMetadata(t *testing.T) {
	docID := uuid.New()
	archived := &model.LegalDocument{
		ID: docID,
		Metadata: map[string]any{
			"archive": map[string]any{
				"archive_ref": "local://lex-earchive-demo/t/d/v1/h.archive",
				"worm_mode":   "none",
			},
		},
	}
	h := newArchiveHandler(&fakeEndpointLister{}, &fakeArchiveDocReader{doc: archived})

	req := httptest.NewRequest("GET", "/documents/"+docID.String()+"/archive", nil)
	req = withAuthAndParam(req, docID.String())
	rr := httptest.NewRecorder()

	h.Status(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rr.Code, rr.Body.String())
	}
	if !bodyContains(rr.Body.Bytes(), "local://lex-earchive-demo") {
		t.Errorf("status body should echo the archive_ref: %s", rr.Body.String())
	}
	var payload struct {
		Data struct {
			Archived bool `json:"archived"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v (%s)", err, rr.Body.String())
	}
	if !payload.Data.Archived {
		t.Errorf("archived document should report archived=true: %s", rr.Body.String())
	}
}

func TestArchiveStatus_UnarchivedReportsFalse(t *testing.T) {
	docID := uuid.New()
	plain := &model.LegalDocument{ID: docID, Metadata: map[string]any{}}
	h := newArchiveHandler(&fakeEndpointLister{}, &fakeArchiveDocReader{doc: plain})

	req := httptest.NewRequest("GET", "/documents/"+docID.String()+"/archive", nil)
	req = withAuthAndParam(req, docID.String())
	rr := httptest.NewRecorder()

	h.Status(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var payload struct {
		Data struct {
			Archived bool `json:"archived"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v (%s)", err, rr.Body.String())
	}
	if payload.Data.Archived {
		t.Errorf("unarchived document should report archived=false: %s", rr.Body.String())
	}
}
