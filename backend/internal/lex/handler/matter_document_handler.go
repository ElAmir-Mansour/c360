package handler

import (
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// MatterDocumentHandler is the transport shell over the matter document-link
// sub-resource (FEATURE 5): list/link/unlink existing repository documents on a
// matter. Mirrors the legal-case document-link handler methods. Route wiring
// (permission tiers, paths) is owned by the integrator in handler/routes.go.
type MatterDocumentHandler struct {
	baseHandler
	service *service.MatterDocumentService
}

func NewMatterDocumentHandler(service *service.MatterDocumentService, logger zerolog.Logger) *MatterDocumentHandler {
	return &MatterDocumentHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

func (h *MatterDocumentHandler) ListDocuments(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.service.ListDocuments(r.Context(), tenantID, matterID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *MatterDocumentHandler) AddDocument(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateMatterDocumentLinkRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.AddDocument(r.Context(), tenantID, userID, matterID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *MatterDocumentHandler) DeleteDocument(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	documentLinkID, err := suiteapi.UUIDParam(r, "documentLinkId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.DeleteDocument(r.Context(), tenantID, userID, matterID, documentLinkID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
