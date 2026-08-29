package handler

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/forms"
)

// formService is the form-authoring operations the handler needs.
type formService interface {
	CreateForm(ctx context.Context, tenantID string, fd *forms.FormDefinition) (*forms.FormDefinition, error)
	GetForm(ctx context.Context, tenantID, id string) (*forms.FormDefinition, error)
	ListForms(ctx context.Context, tenantID string) ([]*forms.FormDefinition, error)
	UpdateForm(ctx context.Context, tenantID, id string, fd *forms.FormDefinition) (*forms.FormDefinition, error)
	DeleteForm(ctx context.Context, tenantID, id string) error
}

// FormHandler serves workflow form-definition authoring routes.
type FormHandler struct {
	forms  formService
	logger zerolog.Logger
}

// NewFormHandler creates a FormHandler.
func NewFormHandler(forms formService, logger zerolog.Logger) *FormHandler {
	return &FormHandler{
		forms:  forms,
		logger: logger.With().Str("handler", "workflow_forms").Logger(),
	}
}

// Routes returns the chi router for /forms.
func (h *FormHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.ListForms)
	r.Post("/", h.CreateForm)
	r.Get("/{id}", h.GetForm)
	r.Put("/{id}", h.UpdateForm)
	r.Delete("/{id}", h.DeleteForm)
	return r
}

type formDefinitionRequest struct {
	Name          string            `json:"name,omitempty"`
	Version       int               `json:"version,omitempty"`
	Locales       []string          `json:"locales"`
	DefaultLocale string            `json:"default_locale"`
	Fields        []forms.FormField `json:"fields"`
}

func (r formDefinitionRequest) toDefinition() *forms.FormDefinition {
	return &forms.FormDefinition{
		Name:          r.Name,
		Version:       r.Version,
		Locales:       r.Locales,
		DefaultLocale: r.DefaultLocale,
		Fields:        r.Fields,
	}
}

// ListForms handles GET /forms.
func (h *FormHandler) ListForms(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	items, err := h.forms.ListForms(r.Context(), user.TenantID)
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Msg("failed to list workflow forms")
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"forms": items, "total": len(items)})
}

// CreateForm handles POST /forms.
func (h *FormHandler) CreateForm(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	var req formDefinitionRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}
	fd, err := h.forms.CreateForm(r.Context(), user.TenantID, req.toDefinition())
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Msg("failed to create workflow form")
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, fd)
}

// GetForm handles GET /forms/{id}.
func (h *FormHandler) GetForm(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "form id is required")
		return
	}
	fd, err := h.forms.GetForm(r.Context(), user.TenantID, id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, fd)
}

// UpdateForm handles PUT /forms/{id}.
func (h *FormHandler) UpdateForm(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "form id is required")
		return
	}
	var req formDefinitionRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}
	fd, err := h.forms.UpdateForm(r.Context(), user.TenantID, id, req.toDefinition())
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Str("form_id", id).Msg("failed to update workflow form")
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, fd)
}

// DeleteForm handles DELETE /forms/{id}.
func (h *FormHandler) DeleteForm(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "form id is required")
		return
	}
	if err := h.forms.DeleteForm(r.Context(), user.TenantID, id); err != nil {
		handleServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
