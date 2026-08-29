package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/bpmn"
	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
)

// fakeDefinitionService satisfies the handler's definitionService contract. Only
// GetByID (export) and Create (import) carry behaviour the BPMN endpoints need;
// the rest are no-ops so the fake compiles against the full interface.
type fakeDefinitionService struct {
	byID       map[string]*model.WorkflowDefinition
	created    *dto.CreateDefinitionRequest
	createErr  error
	getErr     error
	createdDef *model.WorkflowDefinition
}

func (f *fakeDefinitionService) Create(_ context.Context, tenantID, userID string, req dto.CreateDefinitionRequest) (*model.WorkflowDefinition, error) {
	if f.createErr != nil {
		return nil, f.createErr
	}
	cp := req
	f.created = &cp
	def := &model.WorkflowDefinition{
		ID:            "new-def-1",
		TenantID:      tenantID,
		Name:          req.Name,
		Description:   req.Description,
		Category:      req.Category,
		Version:       1,
		Status:        model.DefinitionStatusDraft,
		DefinitionKey: "new-key-1",
		TriggerConfig: req.TriggerConfig,
		Variables:     req.Variables,
		Steps:         req.Steps,
		CreatedBy:     userID,
	}
	f.createdDef = def
	return def, nil
}

func (f *fakeDefinitionService) GetByID(_ context.Context, tenantID, id string) (*model.WorkflowDefinition, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	def, ok := f.byID[id]
	if !ok || def.TenantID != tenantID {
		return nil, model.ErrNotFound
	}
	return def, nil
}

func (f *fakeDefinitionService) List(context.Context, string, string, string, string, string, string, int, int) ([]*model.WorkflowDefinition, int, error) {
	return nil, 0, nil
}
func (f *fakeDefinitionService) Update(context.Context, string, string, string, dto.UpdateDefinitionRequest) (*model.WorkflowDefinition, error) {
	return nil, nil
}
func (f *fakeDefinitionService) Activate(context.Context, string, string) error { return nil }
func (f *fakeDefinitionService) Archive(context.Context, string, string) error  { return nil }
func (f *fakeDefinitionService) Clone(context.Context, string, string, string) (*model.WorkflowDefinition, error) {
	return nil, nil
}
func (f *fakeDefinitionService) Delete(context.Context, string, string) error { return nil }
func (f *fakeDefinitionService) ListVersions(context.Context, string, string) ([]*model.WorkflowDefinition, error) {
	return nil, nil
}

func bpmnDefRouter(svc definitionService) chi.Router {
	h := NewDefinitionHandler(svc, zerolog.Nop())
	r := chi.NewRouter()
	r.Mount("/", h.Routes())
	return r
}

func bpmnDefReq(method, target, body string) *http.Request {
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, target, strings.NewReader(body))
	} else {
		r = httptest.NewRequest(method, target, nil)
	}
	return r.WithContext(auth.WithUser(r.Context(), &auth.ContextUser{ID: "actor-1", TenantID: "tenant-1"}))
}

// sampleDef is a small but multi-type definition used for the handler tests.
func sampleDef() *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID:            "def-1",
		TenantID:      "tenant-1",
		Name:          "Approve Contract",
		DefinitionKey: "approve-contract",
		Version:       1,
		Status:        model.DefinitionStatusDraft,
		TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeManual},
		Variables:     map[string]model.VariableDef{"amount": {Type: "number"}},
		Steps: []model.StepDefinition{
			{ID: "review", Type: model.StepTypeHumanTask, Name: "Review", Config: map[string]interface{}{"assignee": "a"}, Transitions: []model.Transition{{Target: "done"}}},
			{ID: "done", Type: model.StepTypeEnd, Name: "Done"},
		},
	}
}

func TestExportBPMNHandler_ReturnsBPMNXML(t *testing.T) {
	svc := &fakeDefinitionService{byID: map[string]*model.WorkflowDefinition{"def-1": sampleDef()}}
	rec := httptest.NewRecorder()
	bpmnDefRouter(svc).ServeHTTP(rec, bpmnDefReq(http.MethodGet, "/def-1/export.bpmn", ""))

	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Header().Get("Content-Type"), "application/xml")
	require.Contains(t, rec.Header().Get("Content-Disposition"), ".bpmn")

	body := rec.Body.String()
	require.Contains(t, body, "<bpmn:definitions")
	require.Contains(t, body, "<bpmn:userTask")
	require.Contains(t, body, "<bpmn:endEvent")

	// The exported document must itself be importable (endpoint output is valid).
	res, err := bpmn.Import(rec.Body.Bytes())
	require.NoError(t, err)
	require.Len(t, res.Definition.Steps, 2)
}

func TestExportBPMNHandler_NotFound(t *testing.T) {
	svc := &fakeDefinitionService{byID: map[string]*model.WorkflowDefinition{}}
	rec := httptest.NewRecorder()
	bpmnDefRouter(svc).ServeHTTP(rec, bpmnDefReq(http.MethodGet, "/missing/export.bpmn", ""))
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestImportBPMNHandler_CreatesDraft(t *testing.T) {
	// Export a definition, then POST that XML to the import endpoint.
	xmlBytes, err := bpmn.Export(sampleDef())
	require.NoError(t, err)

	svc := &fakeDefinitionService{byID: map[string]*model.WorkflowDefinition{}}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/import", strings.NewReader(string(xmlBytes)))
	req.Header.Set("Content-Type", "application/xml")
	req = req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{ID: "actor-1", TenantID: "tenant-1"}))
	bpmnDefRouter(svc).ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	require.NotNil(t, svc.created, "import should call service.Create")
	require.Equal(t, "Approve Contract", svc.created.Name)
	require.Equal(t, model.DefinitionStatusDraft, svc.createdDef.Status)

	var resp struct {
		Definition dto.DefinitionResponse `json:"definition"`
		Warnings   []string               `json:"warnings"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Equal(t, "new-def-1", resp.Definition.ID)
	require.Len(t, resp.Definition.Steps, 2)
}

func TestImportBPMNHandler_MalformedXML400(t *testing.T) {
	svc := &fakeDefinitionService{}
	rec := httptest.NewRecorder()
	bpmnDefRouter(svc).ServeHTTP(rec, bpmnDefReq(http.MethodPost, "/import", `<not-bpmn`))
	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), "BPMN_IMPORT_INVALID")
	require.Nil(t, svc.created, "malformed import must not create a definition")
}

func TestImportBPMNHandler_UnsupportedConstruct400(t *testing.T) {
	doc := `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d">
  <bpmn:process id="p" name="Bad" isExecutable="true">
    <bpmn:startEvent id="s" />
    <bpmn:scriptTask id="sc" />
    <bpmn:endEvent id="e" />
  </bpmn:process>
</bpmn:definitions>`
	svc := &fakeDefinitionService{}
	rec := httptest.NewRecorder()
	bpmnDefRouter(svc).ServeHTTP(rec, bpmnDefReq(http.MethodPost, "/import", doc))
	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Nil(t, svc.created)
}

func TestImportBPMNHandler_EmptyBody400(t *testing.T) {
	svc := &fakeDefinitionService{}
	rec := httptest.NewRecorder()
	bpmnDefRouter(svc).ServeHTTP(rec, bpmnDefReq(http.MethodPost, "/import", ""))
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestBPMNHandlers_Unauthenticated401(t *testing.T) {
	svc := &fakeDefinitionService{byID: map[string]*model.WorkflowDefinition{"def-1": sampleDef()}}
	r := bpmnDefRouter(svc)

	for _, tc := range []struct{ method, target string }{
		{http.MethodGet, "/def-1/export.bpmn"},
		{http.MethodPost, "/import"},
	} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.target, strings.NewReader("<x/>")))
		require.Equalf(t, http.StatusUnauthorized, rec.Code, "%s %s", tc.method, tc.target)
	}
}
