package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// RequestApprovalPolicyHandler exposes the subject-agnostic request-approval
// policy stack (CAP-006, CAP-007) under /request-approval/policies. It mirrors
// the contract approval-policy handler block but routes approvals for legal
// requests. Routes are gated in routes.go with
// RequireAnyPermission(lex:approval:*, lex:read|write).
type RequestApprovalPolicyHandler struct {
	baseHandler
	svc *service.RequestApprovalPolicyService
}

func NewRequestApprovalPolicyHandler(svc *service.RequestApprovalPolicyService, logger zerolog.Logger) *RequestApprovalPolicyHandler {
	return &RequestApprovalPolicyHandler{
		baseHandler: baseHandler{logger: logger},
		svc:         svc,
	}
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// List GET /request-approval/policies
func (h *RequestApprovalPolicyHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	filters := model.RequestApprovalPolicyListFilters{
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		Page:          page,
		PerPage:       perPage,
		SortColumn:    strings.TrimSpace(r.URL.Query().Get("sort")),
		SortDirection: strings.ToLower(strings.TrimSpace(r.URL.Query().Get("direction"))),
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("status")); raw != "" {
		status := model.RequestApprovalPolicyStatus(raw)
		filters.Status = &status
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("request_type")); raw != "" {
		filters.RequestType = &raw
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("service_id")); raw != "" {
		parsed, err := uuid.Parse(raw)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "service_id must be a valid uuid", nil)
			return
		}
		filters.ServiceID = &parsed
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("stage")); raw != "" {
		stage := model.RequestApprovalStage(raw)
		filters.Stage = &stage
	}
	items, total, err := h.svc.List(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

// Get GET /request-approval/policies/{id}
func (h *RequestApprovalPolicyHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.svc.Get(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// Create POST /request-approval/policies
func (h *RequestApprovalPolicyHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateRequestApprovalPolicyRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	result, err := h.svc.CreateWithConflicts(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, result)
}

// Update PATCH /request-approval/policies/{id}
func (h *RequestApprovalPolicyHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateRequestApprovalPolicyRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	result, err := h.svc.UpdateWithConflicts(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

// Delete DELETE /request-approval/policies/{id}
func (h *RequestApprovalPolicyHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.svc.Delete(r.Context(), tenantID, userID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Archive POST /request-approval/policies/{id}/archive
func (h *RequestApprovalPolicyHandler) Archive(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.svc.Archive(r.Context(), tenantID, userID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

// Recommend GET /request-approval/policies/recommend
func (h *RequestApprovalPolicyHandler) Recommend(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	in := service.RecommendInput{Currency: strings.TrimSpace(r.URL.Query().Get("currency"))}
	if raw := strings.TrimSpace(r.URL.Query().Get("request_type")); raw != "" {
		in.RequestType = &raw
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("service_id")); raw != "" {
		parsed, err := uuid.Parse(raw)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "service_id must be a valid uuid", nil)
			return
		}
		in.ServiceID = &parsed
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("stage")); raw != "" {
		stage := model.RequestApprovalStage(raw)
		in.Stage = &stage
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("department")); raw != "" {
		in.Department = &raw
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("priority_tier")); raw != "" {
		in.PriorityTier = &raw
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("value")); raw != "" {
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "value must be a number", nil)
			return
		}
		in.Value = &value
	}
	recommendation, err := h.svc.Recommend(r.Context(), tenantID, in)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, recommendation)
}

// ---------------------------------------------------------------------------
// Conflict-check
// ---------------------------------------------------------------------------

// ConflictCheck POST /request-approval/policies/conflict-check
func (h *RequestApprovalPolicyHandler) ConflictCheck(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.RequestApprovalPolicyConflictCheckRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	var excludeID *uuid.UUID
	if req.ExcludeID != nil && *req.ExcludeID != "" {
		parsed, perr := uuid.Parse(*req.ExcludeID)
		if perr != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "exclude_id must be a valid uuid", nil)
			return
		}
		excludeID = &parsed
	}
	conflicts, err := h.svc.PreviewConflicts(r.Context(), tenantID, userID, req.CreateRequestApprovalPolicyRequest, excludeID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	hasIdentical := false
	for _, c := range conflicts {
		if c.Identical {
			hasIdentical = true
			break
		}
	}
	suiteapi.WriteData(w, http.StatusOK, dto.RequestApprovalPolicyConflictCheckResponse{
		Conflicts:    conflicts,
		HasConflicts: len(conflicts) > 0,
		HasIdentical: hasIdentical,
	})
}

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

// ListVersions GET /request-approval/policies/{id}/versions
func (h *RequestApprovalPolicyHandler) ListVersions(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	versions, err := h.svc.ListVersions(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, dto.RequestApprovalPolicyVersionsResponse{
		PolicyID: id.String(),
		Versions: versions,
	})
}

// GetVersion GET /request-approval/policies/{id}/versions/{version}
func (h *RequestApprovalPolicyHandler) GetVersion(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	version, ok := h.parseVersionParam(w, r)
	if !ok {
		return
	}
	item, err := h.svc.GetVersion(r.Context(), tenantID, id, version)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// RestoreVersion POST /request-approval/policies/{id}/versions/{version}/restore
func (h *RequestApprovalPolicyHandler) RestoreVersion(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	version, ok := h.parseVersionParam(w, r)
	if !ok {
		return
	}
	item, err := h.svc.RestoreVersion(r.Context(), tenantID, userID, id, version)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

// ListAudit GET /request-approval/policies/{id}/audit
func (h *RequestApprovalPolicyHandler) ListAudit(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	entries, err := h.svc.ListAudit(r.Context(), tenantID, id, page, perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, dto.RequestApprovalPolicyAuditResponse{
		PolicyID: id.String(),
		Entries:  entries,
	})
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

// ListTemplates GET /request-approval/policies/templates
func (h *RequestApprovalPolicyHandler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	templates, err := h.svc.ListTemplates(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, templates)
}

// CreateTemplate POST /request-approval/policies/templates
func (h *RequestApprovalPolicyHandler) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateRequestApprovalPolicyTemplateRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.svc.CreateTemplate(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// GetTemplate GET /request-approval/policies/templates/{id}
func (h *RequestApprovalPolicyHandler) GetTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.svc.GetTemplate(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// UpdateTemplate PATCH /request-approval/policies/templates/{id}
func (h *RequestApprovalPolicyHandler) UpdateTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateRequestApprovalPolicyTemplateRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.svc.UpdateTemplate(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// DeleteTemplate DELETE /request-approval/policies/templates/{id}
func (h *RequestApprovalPolicyHandler) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.svc.DeleteTemplate(r.Context(), tenantID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// InstantiateTemplate POST /request-approval/policies/templates/{id}/instantiate
func (h *RequestApprovalPolicyHandler) InstantiateTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.InstantiateRequestApprovalPolicyTemplateRequest
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
			return
		}
	}
	item, err := h.svc.InstantiateTemplate(r.Context(), tenantID, userID, id, req.Overrides)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// parseVersionParam parses the {version} path param as a positive integer.
func (h *RequestApprovalPolicyHandler) parseVersionParam(w http.ResponseWriter, r *http.Request) (int, bool) {
	raw := chi.URLParam(r, "version")
	version, err := strconv.Atoi(raw)
	if err != nil || version < 1 {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "version must be a positive integer", nil)
		return 0, false
	}
	return version, true
}
