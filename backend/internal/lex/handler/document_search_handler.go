package handler

import (
	"net/http"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// DocumentSearchHandler exposes full-text document search (CAP-169/182). Search
// accepts both GET (?q=...) for simple queries and POST (JSON body) for richer
// filters.
type DocumentSearchHandler struct {
	baseHandler
	service *service.DocumentSearchService
}

func NewDocumentSearchHandler(svc *service.DocumentSearchService, logger zerolog.Logger) *DocumentSearchHandler {
	return &DocumentSearchHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

func (h *DocumentSearchHandler) Search(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	req := dto.DocumentSearchRequest{}
	if r.Method == http.MethodPost {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
			return
		}
	}
	// Query-string params override / supply for GET and augment POST.
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		req.Query = q
	}
	if v := strings.TrimSpace(r.URL.Query().Get("type")); v != "" {
		req.Type = v
	}
	if v := strings.TrimSpace(r.URL.Query().Get("status")); v != "" {
		req.Status = v
	}
	if v := strings.TrimSpace(r.URL.Query().Get("confidentiality")); v != "" {
		req.Confidentiality = v
	}
	if v := strings.TrimSpace(r.URL.Query().Get("category")); v != "" {
		req.Category = v
	}
	hits, total, err := h.service.Search(r.Context(), tenantID, req, page, perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, hits, page, perPage, total)
}

// IndexText stores the extracted/OCR plaintext for a document so the FTS vector
// includes its body (CAP-169).
func (h *DocumentSearchHandler) IndexText(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var body struct {
		ExtractedText string `json:"extracted_text"`
	}
	if err := suiteapi.DecodeJSON(r, &body); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	if err := h.service.IndexExtractedText(r.Context(), tenantID, id, body.ExtractedText); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
