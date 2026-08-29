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

// MatterCommentHandler is the transport shell over matter collaboration notes:
// list/add/update/soft-delete comments on a matter. It mirrors the legal-case
// comment handlers. Route wiring (permission tiers, paths) is owned by the
// integrator in handler/routes.go.
type MatterCommentHandler struct {
	baseHandler
	comments *service.MatterCommentService
}

func NewMatterCommentHandler(comments *service.MatterCommentService, logger zerolog.Logger) *MatterCommentHandler {
	return &MatterCommentHandler{baseHandler: baseHandler{logger: logger}, comments: comments}
}

// authorName resolves the denormalized author display name from the JWT claims
// (email), mirroring how intake_handler derives the requester name.
func (h *MatterCommentHandler) authorName(r *http.Request) string {
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		return strings.TrimSpace(claims.Email)
	}
	return ""
}

func (h *MatterCommentHandler) ListComments(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.comments.ListComments(r.Context(), tenantID, matterID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *MatterCommentHandler) AddComment(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateMatterCommentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.comments.AddComment(r.Context(), tenantID, userID, matterID, h.authorName(r), req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *MatterCommentHandler) UpdateComment(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	commentID, err := suiteapi.UUIDParam(r, "commentId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateMatterCommentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.comments.UpdateComment(r.Context(), tenantID, userID, matterID, commentID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *MatterCommentHandler) DeleteComment(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	commentID, err := suiteapi.UUIDParam(r, "commentId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.comments.DeleteComment(r.Context(), tenantID, userID, matterID, commentID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
