package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/drafting"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// DraftingHandler exposes the AID-* generative drafting endpoints (clause/
// contract generation, rewrite, fallbacks, translation, summary, glossary,
// template assembly, RFP response, and obligation-extraction QA review).
type DraftingHandler struct {
	baseHandler
	service *service.DraftingService
}

func NewDraftingHandler(svc *service.DraftingService, logger zerolog.Logger) *DraftingHandler {
	return &DraftingHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

// draftRun decodes a JSON body into REQ, calls the tenant-scoped service method,
// and writes the typed result. It keeps every drafting endpoint to one line.
func draftRun[REQ any, RES any](
	h *DraftingHandler,
	w http.ResponseWriter,
	r *http.Request,
	fn func(ctx context.Context, tenantID uuid.UUID, req REQ) (RES, error),
) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	var req REQ
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	out, err := fn(r.Context(), tenantID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

// GenerateClause handles POST /drafting/clauses (AID-01).
func (h *DraftingHandler) GenerateClause(w http.ResponseWriter, r *http.Request) {
	draftRun(h, w, r, h.service.GenerateClause)
}

// GenerateClauseStream handles POST /drafting/clauses/stream (AID-01, SSE): the
// clause text streams word-by-word as `event: token` frames, then the full
// structured clause arrives as a terminal `event: clause` + `event: done`. On a
// pre-stream failure it returns a normal HTTP error; once the SSE has begun,
// errors are delivered in-band as an `event: error` frame.
func (h *DraftingHandler) GenerateClauseStream(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	var req drafting.ClauseRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	if !h.service.Enabled() {
		// Empty message → WriteError localizes DRAFTING_UNAVAILABLE from the
		// bilingual catalog so the Arabic drafting panel renders Arabic copy.
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "DRAFTING_UNAVAILABLE", "", nil)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "STREAM_UNSUPPORTED", "", nil)
		return
	}

	hdr := w.Header()
	hdr.Set("Content-Type", "text/event-stream; charset=utf-8")
	hdr.Set("Cache-Control", "no-cache, no-transform")
	hdr.Set("Connection", "keep-alive")
	hdr.Set("X-Accel-Buffering", "no") // defeat nginx/proxy response buffering
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	start := time.Now()
	firstToken := true
	emit := func(delta string) {
		if firstToken {
			firstToken = false
			h.logger.Info().Dur("ttft", time.Since(start)).Msg("clause stream: first token flushed")
		}
		payload, _ := json.Marshal(map[string]string{"text": delta})
		fmt.Fprintf(w, "event: token\ndata: %s\n\n", payload)
		flusher.Flush()
	}

	out, err := h.service.GenerateClauseStream(r.Context(), tenantID, req, emit)
	if err != nil {
		// Headers already committed → deliver the failure in-band as an SSE frame.
		writeSSEError(w, flusher, err.Error())
		return
	}
	payload, _ := json.Marshal(out)
	fmt.Fprintf(w, "event: clause\ndata: %s\n\n", payload)
	fmt.Fprint(w, "event: done\ndata: {}\n\n")
	flusher.Flush()
}

// DraftContract handles POST /drafting/contracts (AID-02).
func (h *DraftingHandler) DraftContract(w http.ResponseWriter, r *http.Request) {
	draftRun(h, w, r, h.service.DraftContract)
}

// RewriteClause handles POST /drafting/clauses/rewrite (AID-03).
func (h *DraftingHandler) RewriteClause(w http.ResponseWriter, r *http.Request) {
	draftRun(h, w, r, h.service.RewriteClause)
}

// SuggestFallbacks handles POST /drafting/clauses/fallbacks (AID-04).
func (h *DraftingHandler) SuggestFallbacks(w http.ResponseWriter, r *http.Request) {
	draftRun(h, w, r, h.service.SuggestFallbacks)
}

// Translate handles POST /drafting/translate (AID-05).
func (h *DraftingHandler) Translate(w http.ResponseWriter, r *http.Request) {
	draftRun(h, w, r, h.service.Translate)
}

// Summarize handles POST /drafting/summary (AID-06).
func (h *DraftingHandler) Summarize(w http.ResponseWriter, r *http.Request) {
	draftRun(h, w, r, h.service.Summarize)
}

// Glossary handles POST /drafting/glossary (AID-07).
func (h *DraftingHandler) Glossary(w http.ResponseWriter, r *http.Request) {
	draftRun(h, w, r, h.service.Glossary)
}

// Assemble handles POST /drafting/assemble (AID-08, deterministic).
func (h *DraftingHandler) Assemble(w http.ResponseWriter, r *http.Request) {
	draftRun(h, w, r, h.service.Assemble)
}

// DraftRFPResponse handles POST /drafting/rfp-response (AID-10).
func (h *DraftingHandler) DraftRFPResponse(w http.ResponseWriter, r *http.Request) {
	draftRun(h, w, r, h.service.DraftRFPResponse)
}

// ReviewObligationExtraction handles POST /drafting/obligations/qa-review (AID-11).
func (h *DraftingHandler) ReviewObligationExtraction(w http.ResponseWriter, r *http.Request) {
	draftRun(h, w, r, h.service.ReviewObligationExtraction)
}

// ---- Feature 4: engine-backed draft human review ----

// SubmitDraftForReview handles POST /drafting/{id}/submit-for-review. It creates
// an engine-tracked HumanTask carrying the draft content and persists the
// review linkage. {id} is the stable, caller-supplied draft identifier.
func (h *DraftingHandler) SubmitDraftForReview(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	draftID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.SubmitDraftForReviewRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	review, err := h.service.SubmitDraftForReview(r.Context(), tenantID, userID, draftID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, review)
}

// GetDraftReview handles GET /drafting/{id}/review, returning the review status
// projection for a draft.
func (h *DraftingHandler) GetDraftReview(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	draftID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	review, err := h.service.GetDraftReview(r.Context(), tenantID, draftID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, review)
}

// ---- AID-09: prompt library ----

// ListPrompts handles GET /drafting/prompts.
func (h *DraftingHandler) ListPrompts(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	items, total, err := h.service.ListPrompts(r.Context(), tenantID, page, perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

// CreatePrompt handles POST /drafting/prompts.
func (h *DraftingHandler) CreatePrompt(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreatePromptTemplateRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.CreatePrompt(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// GetPrompt handles GET /drafting/prompts/{id}.
func (h *DraftingHandler) GetPrompt(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetPrompt(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// UpdatePrompt handles PUT /drafting/prompts/{id}.
func (h *DraftingHandler) UpdatePrompt(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdatePromptTemplateRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpdatePrompt(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// DeletePrompt handles DELETE /drafting/prompts/{id}.
func (h *DraftingHandler) DeletePrompt(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.DeletePrompt(r.Context(), tenantID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"deleted": true, "id": id})
}

// RunPrompt handles POST /drafting/prompts/{id}/run.
func (h *DraftingHandler) RunPrompt(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RunPromptRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	out, err := h.service.RunPrompt(r.Context(), tenantID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}
