package handler

import (
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// MatterLinkHandler is the transport shell over cross-domain related-items
// links on a matter (FEATURE 9): list, add, and remove generic edges to sibling
// lex entities. Route wiring (permission tiers, paths) is owned by the
// integrator in handler/routes.go.
type MatterLinkHandler struct {
	baseHandler
	links *service.MatterLinkService
}

func NewMatterLinkHandler(links *service.MatterLinkService, logger zerolog.Logger) *MatterLinkHandler {
	return &MatterLinkHandler{baseHandler: baseHandler{logger: logger}, links: links}
}

// ListRelated handles GET /matters/{id}/related.
func (h *MatterLinkHandler) ListRelated(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.links.ListLinks(r.Context(), tenantID, matterID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

// AddRelated handles POST /matters/{id}/related.
func (h *MatterLinkHandler) AddRelated(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateMatterLinkRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.links.AddLink(r.Context(), tenantID, userID, matterID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// DeleteRelated handles DELETE /matters/{id}/related/{linkId}.
func (h *MatterLinkHandler) DeleteRelated(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	linkID, err := suiteapi.UUIDParam(r, "linkId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.links.DeleteLink(r.Context(), tenantID, userID, matterID, linkID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
