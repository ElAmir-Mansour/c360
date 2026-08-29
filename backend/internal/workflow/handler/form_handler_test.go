package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/workflow/model"
)

type fakeFormService struct {
	created *forms.FormDefinition
	got     *forms.FormDefinition
	list    []*forms.FormDefinition
	updated *forms.FormDefinition

	createErr error
	getErr    error
	listErr   error
	updateErr error
	deleteErr error

	gotTenant string
	gotID     string
	deletedID string
}

func (f *fakeFormService) CreateForm(_ context.Context, tenantID string, fd *forms.FormDefinition) (*forms.FormDefinition, error) {
	f.gotTenant = tenantID
	if f.createErr != nil {
		return nil, f.createErr
	}
	fd.ID = "form-new"
	fd.TenantID = tenantID
	f.created = fd
	return fd, nil
}

func (f *fakeFormService) GetForm(_ context.Context, tenantID, id string) (*forms.FormDefinition, error) {
	f.gotTenant, f.gotID = tenantID, id
	if f.getErr != nil {
		return nil, f.getErr
	}
	return f.got, nil
}

func (f *fakeFormService) ListForms(_ context.Context, tenantID string) ([]*forms.FormDefinition, error) {
	f.gotTenant = tenantID
	if f.listErr != nil {
		return nil, f.listErr
	}
	return f.list, nil
}

func (f *fakeFormService) UpdateForm(_ context.Context, tenantID, id string, fd *forms.FormDefinition) (*forms.FormDefinition, error) {
	f.gotTenant, f.gotID = tenantID, id
	if f.updateErr != nil {
		return nil, f.updateErr
	}
	fd.ID = id
	fd.TenantID = tenantID
	f.updated = fd
	return fd, nil
}

func (f *fakeFormService) DeleteForm(_ context.Context, tenantID, id string) error {
	f.gotTenant, f.deletedID = tenantID, id
	return f.deleteErr
}

func newFormHandler(svc formService) *FormHandler {
	return NewFormHandler(svc, zerolog.Nop())
}

func withWorkflowUser(req *http.Request) *http.Request {
	return req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{ID: "user-1", TenantID: "tenant-1"}))
}

func sampleFormBody() string {
	return `{"name":"watheeq_approval","version":1,"locales":["ar","en"],"default_locale":"en","fields":[{"name":"decision_reason","type":"textarea","label":{"ar":"Decision reason AR","en":"Decision reason"},"required":true}]}`
}

func sampleFormDefinition(id string) *forms.FormDefinition {
	return &forms.FormDefinition{
		ID:            id,
		TenantID:      "tenant-1",
		Name:          "watheeq_approval",
		Version:       1,
		Locales:       []string{"ar", "en"},
		DefaultLocale: "en",
		Fields: []forms.FormField{{
			Name:     "decision_reason",
			Type:     forms.FieldTextarea,
			Label:    forms.LocalizedText{AR: "Decision reason AR", EN: "Decision reason"},
			Required: true,
		}},
	}
}

func TestFormHandler_CreateForm(t *testing.T) {
	svc := &fakeFormService{}
	h := newFormHandler(svc)

	req := withWorkflowUser(httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(sampleFormBody())))
	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	require.Equal(t, "tenant-1", svc.gotTenant)
	require.NotNil(t, svc.created)
	require.Equal(t, "watheeq_approval", svc.created.Name)
	require.Len(t, svc.created.Fields, 1)

	var resp forms.FormDefinition
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	require.Equal(t, "form-new", resp.ID)
	require.Equal(t, "decision_reason", resp.Fields[0].Name)
}

func TestFormHandler_CreateForm_Errors(t *testing.T) {
	t.Run("unauthorized", func(t *testing.T) {
		h := newFormHandler(&fakeFormService{})
		req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(sampleFormBody()))
		rec := httptest.NewRecorder()
		h.Routes().ServeHTTP(rec, req)
		require.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("invalid body", func(t *testing.T) {
		h := newFormHandler(&fakeFormService{})
		req := withWorkflowUser(httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"fields":`)))
		rec := httptest.NewRecorder()
		h.Routes().ServeHTTP(rec, req)
		require.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("conflict", func(t *testing.T) {
		h := newFormHandler(&fakeFormService{createErr: model.ErrConflict})
		req := withWorkflowUser(httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(sampleFormBody())))
		rec := httptest.NewRecorder()
		h.Routes().ServeHTTP(rec, req)
		require.Equal(t, http.StatusConflict, rec.Code)
	})
}

func TestFormHandler_ListAndGetForms(t *testing.T) {
	svc := &fakeFormService{
		list: []*forms.FormDefinition{sampleFormDefinition("form-1"), sampleFormDefinition("form-2")},
		got:  sampleFormDefinition("form-1"),
	}
	h := newFormHandler(svc)

	listReq := withWorkflowUser(httptest.NewRequest(http.MethodGet, "/", nil))
	listRec := httptest.NewRecorder()
	h.Routes().ServeHTTP(listRec, listReq)
	require.Equal(t, http.StatusOK, listRec.Code)

	var listResp struct {
		Forms []*forms.FormDefinition `json:"forms"`
		Total int                     `json:"total"`
	}
	require.NoError(t, json.NewDecoder(listRec.Body).Decode(&listResp))
	require.Equal(t, 2, listResp.Total)
	require.Len(t, listResp.Forms, 2)

	getReq := withWorkflowUser(httptest.NewRequest(http.MethodGet, "/form-1", nil))
	getRec := httptest.NewRecorder()
	h.Routes().ServeHTTP(getRec, getReq)
	require.Equal(t, http.StatusOK, getRec.Code)
	require.Equal(t, "form-1", svc.gotID)
}

func TestFormHandler_UpdateAndDeleteForm(t *testing.T) {
	svc := &fakeFormService{}
	h := newFormHandler(svc)

	updateReq := withWorkflowUser(httptest.NewRequest(http.MethodPut, "/form-1", bytes.NewBufferString(sampleFormBody())))
	updateRec := httptest.NewRecorder()
	h.Routes().ServeHTTP(updateRec, updateReq)
	require.Equal(t, http.StatusOK, updateRec.Code)
	require.Equal(t, "form-1", svc.gotID)
	require.NotNil(t, svc.updated)
	require.Equal(t, "decision_reason", svc.updated.Fields[0].Name)

	deleteReq := withWorkflowUser(httptest.NewRequest(http.MethodDelete, "/form-1", nil))
	deleteRec := httptest.NewRecorder()
	h.Routes().ServeHTTP(deleteRec, deleteReq)
	require.Equal(t, http.StatusNoContent, deleteRec.Code)
	require.Equal(t, "form-1", svc.deletedID)
}

func TestFormHandler_NotFound(t *testing.T) {
	h := newFormHandler(&fakeFormService{getErr: model.ErrNotFound})

	req := withWorkflowUser(httptest.NewRequest(http.MethodGet, "/missing", nil))
	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, req)

	require.Equal(t, http.StatusNotFound, rec.Code)
}
