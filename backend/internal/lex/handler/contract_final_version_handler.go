package handler

import (
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// ContractFinalVersionHandler exposes the review-desk final-version ceremony
// (CAP-117) under POST /contracts/{id}/review-desk/final-version. It references
// contracts by id and never edits the existing contract or review-desk handlers.
// The approval gate (latest recommendation must be "approved") is enforced inside
// the service; an unmet gate surfaces as a 409.
type ContractFinalVersionHandler struct {
	baseHandler
	service *service.ContractFinalVersionService
}

func NewContractFinalVersionHandler(service *service.ContractFinalVersionService, logger zerolog.Logger) *ContractFinalVersionHandler {
	return &ContractFinalVersionHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

func (h *ContractFinalVersionHandler) UploadFinalVersion(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UploadContractFinalVersionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	result, err := h.service.UploadFinalVersion(r.Context(), tenantID, userID, contractID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, result)
}
