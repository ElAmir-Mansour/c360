package handler

import (
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// ContractClauseAmendmentHandler is the transport shell over proposed clause
// amendments (CAP-111): list/propose amendments on a clause and accept/reject
// one. It mirrors ClauseHandler / MatterCommentHandler. Route wiring (permission
// tiers, paths) is owned by the integrator in handler/routes.go.
type ContractClauseAmendmentHandler struct {
	baseHandler
	amendments *service.ContractClauseAmendmentService
}

func NewContractClauseAmendmentHandler(amendments *service.ContractClauseAmendmentService, logger zerolog.Logger) *ContractClauseAmendmentHandler {
	return &ContractClauseAmendmentHandler{baseHandler: baseHandler{logger: logger}, amendments: amendments}
}

func (h *ContractClauseAmendmentHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	clauseID, err := suiteapi.UUIDParam(r, "clauseId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.amendments.ListAmendments(r.Context(), tenantID, contractID, clauseID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *ContractClauseAmendmentHandler) Propose(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	clauseID, err := suiteapi.UUIDParam(r, "clauseId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.ProposeClauseAmendmentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.amendments.ProposeAmendment(r.Context(), tenantID, userID, contractID, clauseID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *ContractClauseAmendmentHandler) Decide(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	clauseID, err := suiteapi.UUIDParam(r, "clauseId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	amendmentID, err := suiteapi.UUIDParam(r, "amendmentId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.DecideClauseAmendmentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.amendments.DecideAmendment(r.Context(), tenantID, userID, contractID, clauseID, amendmentID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}
