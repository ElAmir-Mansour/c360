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

// RequestNoteHandler is the transport shell over internal request notes: list and
// add free-form collaboration notes on a legal request. It mirrors the matter
// comment handler. Route wiring (permission tiers, paths) is owned by the
// integrator in handler/routes.go.
type RequestNoteHandler struct {
	baseHandler
	notes *service.RequestNoteService
}

func NewRequestNoteHandler(notes *service.RequestNoteService, logger zerolog.Logger) *RequestNoteHandler {
	return &RequestNoteHandler{baseHandler: baseHandler{logger: logger}, notes: notes}
}

// authorName resolves the denormalized author display name from the JWT claims
// (email), mirroring matter_comment_handler.
func (h *RequestNoteHandler) authorName(r *http.Request) string {
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		return strings.TrimSpace(claims.Email)
	}
	return ""
}

func (h *RequestNoteHandler) ListNotes(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.notes.ListNotes(r.Context(), tenantID, requestID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, dto.NewRequestNoteResponses(items))
}

func (h *RequestNoteHandler) AddNote(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateRequestNoteRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.notes.AddNote(r.Context(), tenantID, userID, requestID, h.authorName(r), req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, dto.NewRequestNoteResponse(*item))
}
