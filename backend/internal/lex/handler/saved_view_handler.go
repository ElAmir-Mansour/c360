package handler

import (
	"net/http"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// SavedViewHandler is the transport shell over the server-side saved-views
// surface (#12): named list-workspace configurations per namespace with share
// scopes (personal/team/org) and a default-for-role marker.
//
//	GET    /saved-views?namespace=lex-contracts  -> views visible to the caller
//	POST   /saved-views                          -> create (owner = caller)
//	PUT    /saved-views/{id}                     -> partial update
//	DELETE /saved-views/{id}                     -> delete
//
// Route wiring (permission tier, paths) is owned by the integrator in
// handler/routes.go. Share-scope write rules (personal = owner-only; shared =
// owner or lex:catalog:manage) and the one-default-per-role upsert live in the
// service, which receives the caller's JWT role slugs for the manage check.
type SavedViewHandler struct {
	baseHandler
	service *service.SavedViewService
}

const reportDefinitionNamespace = "lex-report-builder"

func NewSavedViewHandler(svc *service.SavedViewService, logger zerolog.Logger) *SavedViewHandler {
	return &SavedViewHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

// roleSlugs reads the caller's role slugs from the JWT claims (the
// authoritative source), falling back to the context user, mirroring
// PersonaHandler.roleSlugs.
func (h *SavedViewHandler) roleSlugs(r *http.Request) []string {
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		return claims.Roles
	}
	if user := auth.UserFromContext(r.Context()); user != nil {
		return user.Roles
	}
	return nil
}

// List returns the caller-visible saved views for one namespace.
// GET /saved-views?namespace=lex-contracts
func (h *SavedViewHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	namespace := strings.TrimSpace(r.URL.Query().Get("namespace"))
	if namespace == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "namespace query parameter is required", nil)
		return
	}
	items, err := h.service.List(r.Context(), tenantID, userID, namespace)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

// Create stores a new saved view owned by the caller.
// POST /saved-views
func (h *SavedViewHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateSavedViewRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	created, err := h.service.Create(r.Context(), tenantID, userID, h.roleSlugs(r), req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, created)
}

// Update partially updates one saved view.
// PUT /saved-views/{id}
func (h *SavedViewHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateSavedViewRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	updated, err := h.service.Update(r.Context(), tenantID, userID, h.roleSlugs(r), id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, updated)
}

// Delete removes one saved view.
// DELETE /saved-views/{id}
func (h *SavedViewHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.Delete(r.Context(), tenantID, userID, h.roleSlugs(r), id); err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ListReportDefinitions exposes the report-builder namespace without accepting
// an arbitrary namespace query parameter. This keeps lex:report:read scoped to
// report definitions while the general saved-view workspace remains lex:read.
func (h *SavedViewHandler) ListReportDefinitions(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	items, err := h.service.List(r.Context(), tenantID, userID, reportDefinitionNamespace)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

// CreateReportDefinition stores a saved-view row in the fixed report-builder
// namespace. Any namespace supplied by the client is deliberately ignored.
func (h *SavedViewHandler) CreateReportDefinition(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateSavedViewRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	req.Namespace = reportDefinitionNamespace
	created, err := h.service.Create(r.Context(), tenantID, userID, h.roleSlugs(r), req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, created)
}

// UpdateReportDefinition applies a partial update only when the addressed row
// belongs to the report-builder namespace.
func (h *SavedViewHandler) UpdateReportDefinition(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateSavedViewRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	updated, err := h.service.UpdateInNamespace(
		r.Context(),
		tenantID,
		userID,
		h.roleSlugs(r),
		id,
		reportDefinitionNamespace,
		req,
	)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, updated)
}

// DeleteReportDefinition removes only a row from the fixed report-builder
// namespace, under the same owner/shared-scope rules as normal saved views.
func (h *SavedViewHandler) DeleteReportDefinition(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.DeleteInNamespace(
		r.Context(),
		tenantID,
		userID,
		h.roleSlugs(r),
		id,
		reportDefinitionNamespace,
	); err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]string{"status": "deleted"})
}
