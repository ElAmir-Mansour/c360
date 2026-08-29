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

// ContractClauseCommentHandler is the transport shell over clause collaboration
// notes (CAP-110): list/add/update/soft-delete comments on a contract clause. It
// clones MatterCommentHandler. Route wiring (permission tiers, paths) is owned by
// the integrator in handler/routes.go.
type ContractClauseCommentHandler struct {
	baseHandler
	comments *service.ContractClauseCommentService
}

func NewContractClauseCommentHandler(comments *service.ContractClauseCommentService, logger zerolog.Logger) *ContractClauseCommentHandler {
	return &ContractClauseCommentHandler{baseHandler: baseHandler{logger: logger}, comments: comments}
}

// authorName resolves the denormalized author display name from the JWT claims
// (email), mirroring MatterCommentHandler.
func (h *ContractClauseCommentHandler) authorName(r *http.Request) string {
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		return strings.TrimSpace(claims.Email)
	}
	return ""
}

func (h *ContractClauseCommentHandler) ListComments(w http.ResponseWriter, r *http.Request) {
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
	items, err := h.comments.ListComments(r.Context(), tenantID, contractID, clauseID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *ContractClauseCommentHandler) AddComment(w http.ResponseWriter, r *http.Request) {
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
	var req dto.CreateContractClauseCommentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.comments.AddComment(r.Context(), tenantID, userID, contractID, clauseID, h.authorName(r), req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *ContractClauseCommentHandler) UpdateComment(w http.ResponseWriter, r *http.Request) {
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
	commentID, err := suiteapi.UUIDParam(r, "commentId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateContractClauseCommentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.comments.UpdateComment(r.Context(), tenantID, userID, contractID, clauseID, commentID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractClauseCommentHandler) DeleteComment(w http.ResponseWriter, r *http.Request) {
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
	commentID, err := suiteapi.UUIDParam(r, "commentId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.comments.DeleteComment(r.Context(), tenantID, userID, contractID, clauseID, commentID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
