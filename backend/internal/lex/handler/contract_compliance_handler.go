package handler

import (
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// ContractComplianceHandler is the transport shell over CAP-109 (regulatory
// compliance check): read the contract's matched compliance issues + roll-up,
// and record/flip the per-issue resolution state. Route wiring (permission tiers,
// paths) is owned by the integrator in handler/routes.go.
type ContractComplianceHandler struct {
	baseHandler
	compliance *service.ContractComplianceService
}

func NewContractComplianceHandler(compliance *service.ContractComplianceService, logger zerolog.Logger) *ContractComplianceHandler {
	return &ContractComplianceHandler{baseHandler: baseHandler{logger: logger}, compliance: compliance}
}

// Check serves GET /contracts/{id}/compliance-check.
func (h *ContractComplianceHandler) Check(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.compliance.Check(r.Context(), tenantID, contractID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

// CreateReview serves POST /contracts/{id}/compliance-reviews.
func (h *ContractComplianceHandler) CreateReview(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateComplianceReviewRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.compliance.CreateReview(r.Context(), tenantID, userID, contractID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// UpdateReview serves PUT /contracts/{id}/compliance-reviews/{reviewId}.
func (h *ContractComplianceHandler) UpdateReview(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	reviewID, err := suiteapi.UUIDParam(r, "reviewId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateComplianceReviewRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.compliance.UpdateReview(r.Context(), tenantID, userID, contractID, reviewID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}
