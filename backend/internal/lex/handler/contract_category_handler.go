package handler

import (
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// ContractCategoryHandler is the transport shell over the manual contract
// categorization surface (CAP-123): list the tenant category catalog and apply
// operator-selected categories onto a contract. Route wiring (permission tiers,
// paths) is owned by the integrator in handler/routes.go. This is DISTINCT from
// ContractHandler.Classify (the AI ClassificationResult path).
type ContractCategoryHandler struct {
	baseHandler
	service *service.ContractCategoryService
}

func NewContractCategoryHandler(service *service.ContractCategoryService, logger zerolog.Logger) *ContractCategoryHandler {
	return &ContractCategoryHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

// ListCategories returns the tenant's manual category catalog (the dropdown feed).
// GET /contracts/categories — lex:read.
func (h *ContractCategoryHandler) ListCategories(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	items, err := h.service.ListCategories(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

// Categorize applies operator-selected category slugs onto a contract.
// POST /contracts/{id}/categorize — lex:write.
func (h *ContractCategoryHandler) Categorize(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CategorizeContractRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	result, err := h.service.CategorizeContract(r.Context(), tenantID, userID, contractID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}
