package handler

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// approval_governance_handler.go exposes the L2 approval-policy governance
// surface (version history, audit log, conflict-check, templates) on the
// ContractHandler. Reads, writes and destructive ops are gated by the granular
// lex:approval:* permissions in routes.go.

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

// ListApprovalPolicyVersions GET /workflow-policies/approval/{id}/versions
func (h *ContractHandler) ListApprovalPolicyVersions(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	versions, err := h.workflowService.ListApprovalPolicyVersions(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, dto.ApprovalPolicyVersionsResponse{
		PolicyID: id.String(),
		Versions: versions,
	})
}

// GetApprovalPolicyVersion GET /workflow-policies/approval/{id}/versions/{version}
func (h *ContractHandler) GetApprovalPolicyVersion(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	version, ok := parseVersionParam(w, r)
	if !ok {
		return
	}
	item, err := h.workflowService.GetApprovalPolicyVersion(r.Context(), tenantID, id, version)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// RestoreApprovalPolicyVersion POST /workflow-policies/approval/{id}/versions/{version}/restore
func (h *ContractHandler) RestoreApprovalPolicyVersion(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	version, ok := parseVersionParam(w, r)
	if !ok {
		return
	}
	item, err := h.workflowService.RestoreApprovalPolicyVersion(r.Context(), tenantID, userID, id, version)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

// ListApprovalPolicyAudit GET /workflow-policies/approval/{id}/audit (paginated)
func (h *ContractHandler) ListApprovalPolicyAudit(w http.ResponseWriter, r *http.Request) {
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
	entries, err := h.workflowService.ListApprovalPolicyAudit(r.Context(), tenantID, id, page, perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, dto.ApprovalPolicyAuditResponse{
		PolicyID: id.String(),
		Entries:  entries,
	})
}

// ---------------------------------------------------------------------------
// Conflict-check
// ---------------------------------------------------------------------------

// ConflictCheckApprovalPolicy POST /workflow-policies/approval/conflict-check
func (h *ContractHandler) ConflictCheckApprovalPolicy(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.ApprovalPolicyConflictCheckRequest
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
	conflicts, err := h.workflowService.PreviewApprovalPolicyConflicts(r.Context(), tenantID, userID, req.CreateApprovalPolicyRequest, excludeID)
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
	suiteapi.WriteData(w, http.StatusOK, dto.ApprovalPolicyConflictCheckResponse{
		Conflicts:    conflicts,
		HasConflicts: len(conflicts) > 0,
		HasIdentical: hasIdentical,
	})
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

// ListApprovalPolicyTemplates GET /workflow-policies/approval/templates
func (h *ContractHandler) ListApprovalPolicyTemplates(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	templates, err := h.workflowService.ListApprovalPolicyTemplates(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, templates)
}

// CreateApprovalPolicyTemplate POST /workflow-policies/approval/templates
func (h *ContractHandler) CreateApprovalPolicyTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateApprovalPolicyTemplateRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.workflowService.CreateApprovalPolicyTemplate(r.Context(), tenantID, userID, service.CreateApprovalPolicyTemplateRequest{
		Name:        req.Name,
		Description: req.Description,
		Category:    req.Category,
		Definition:  req.Definition,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// GetApprovalPolicyTemplate GET /workflow-policies/approval/templates/{id}
func (h *ContractHandler) GetApprovalPolicyTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.workflowService.GetApprovalPolicyTemplate(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// UpdateApprovalPolicyTemplate PATCH /workflow-policies/approval/templates/{id}
func (h *ContractHandler) UpdateApprovalPolicyTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateApprovalPolicyTemplateRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.workflowService.UpdateApprovalPolicyTemplate(r.Context(), tenantID, userID, id, service.UpdateApprovalPolicyTemplateRequest{
		Name:        req.Name,
		Description: req.Description,
		Category:    req.Category,
		Definition:  req.Definition,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// DeleteApprovalPolicyTemplate DELETE /workflow-policies/approval/templates/{id}
func (h *ContractHandler) DeleteApprovalPolicyTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.workflowService.DeleteApprovalPolicyTemplate(r.Context(), tenantID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// InstantiateApprovalPolicyTemplate POST /workflow-policies/approval/templates/{id}/instantiate
func (h *ContractHandler) InstantiateApprovalPolicyTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.InstantiateApprovalPolicyTemplateRequest
	// Body is optional: an empty body simply instantiates the template as-is.
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
			return
		}
	}
	item, err := h.workflowService.InstantiateApprovalPolicyFromTemplate(r.Context(), tenantID, userID, id, req.Overrides)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// parseVersionParam parses the {version} path parameter as a positive integer,
// writing a 400 and returning ok=false on failure.
func parseVersionParam(w http.ResponseWriter, r *http.Request) (int, bool) {
	raw := chi.URLParam(r, "version")
	version, err := strconv.Atoi(raw)
	if err != nil || version < 1 {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "version must be a positive integer", nil)
		return 0, false
	}
	return version, true
}
