package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

var pleadingSortColumns = map[string]string{
	"pleading_number": "p.pleading_number",
	"status":          "p.status",
	"type":            "p.type",
	"updated_at":      "p.updated_at",
	"created_at":      "p.created_at",
}

var expertSortColumns = map[string]string{
	"expert_name":     "e.expert_name",
	"status":          "e.status",
	"report_due_date": "e.report_due_date",
	"updated_at":      "e.updated_at",
	"created_at":      "e.created_at",
}

var judgmentSortColumns = map[string]string{
	"judgment_ref":   "j.judgment_ref",
	"judgment_date":  "j.judgment_date",
	"recommendation": "j.recommendation",
	"updated_at":     "j.updated_at",
	"created_at":     "j.created_at",
}

var defendantSortColumns = map[string]string{
	"plaintiff_name":    "d.plaintiff_name",
	"status":            "d.status",
	"notification_date": "d.notification_date",
	"updated_at":        "d.updated_at",
	"created_at":        "d.created_at",
}

// LitigationHandler exposes the Phase-3 plaintiff/defendant litigation flows
// (CAP-052..073): pleadings, hearing reports, experts, judgments, and defendant
// flows. It composes the three litigation services and mirrors MatterHandler's
// tenant/user extraction + error mapping conventions.
type LitigationHandler struct {
	baseHandler
	pleadings  *service.LitigationPleadingService
	judgments  *service.LitigationJudgmentService
	defendants *service.LitigationDefendantService
}

func NewLitigationHandler(
	pleadings *service.LitigationPleadingService,
	judgments *service.LitigationJudgmentService,
	defendants *service.LitigationDefendantService,
	logger zerolog.Logger,
) *LitigationHandler {
	return &LitigationHandler{
		baseHandler: baseHandler{logger: logger},
		pleadings:   pleadings,
		judgments:   judgments,
		defendants:  defendants,
	}
}

// ============================================================================
// Pleadings (CAP-052..055)
// ============================================================================

func (h *LitigationHandler) CreatePleading(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	var req dto.CreatePleadingRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.pleadings.CreatePleading(r.Context(), tenantID, userID, caseID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// GeneratePleading starts a detachable background generation job and streams
// progress to the initiating browser. Closing the browser only unsubscribes this
// response; the job continues and persists its terminal state on the pleading.
func (h *LitigationHandler) GeneratePleading(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	pleadingID, ok := h.uuidParam(w, r, "pleadingId")
	if !ok {
		return
	}
	if _, ok := w.(http.Flusher); !ok {
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "STREAM_UNSUPPORTED", "", nil)
		return
	}
	var req dto.GeneratePleadingRequest
	if !decodeBody(w, r, &req) {
		return
	}
	state, events, unsubscribe, err := h.pleadings.StartPleadingGeneration(
		r.Context(), tenantID, userID, caseID, pleadingID, req,
	)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	h.streamPleadingGeneration(w, r, http.StatusAccepted, state, events, unsubscribe)
}

func (h *LitigationHandler) RetryPleadingGeneration(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	pleadingID, ok := h.uuidParam(w, r, "pleadingId")
	if !ok {
		return
	}
	if _, ok := w.(http.Flusher); !ok {
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "STREAM_UNSUPPORTED", "", nil)
		return
	}
	var req dto.GeneratePleadingRequest
	if !decodeBody(w, r, &req) {
		return
	}
	state, events, unsubscribe, err := h.pleadings.RetryPleadingGeneration(
		r.Context(), tenantID, userID, caseID, pleadingID, req,
	)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	h.streamPleadingGeneration(w, r, http.StatusAccepted, state, events, unsubscribe)
}

func (h *LitigationHandler) GetPleadingGeneration(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	pleadingID, ok := h.uuidParam(w, r, "pleadingId")
	if !ok {
		return
	}
	state, err := h.pleadings.GetPleadingGeneration(r.Context(), tenantID, caseID, pleadingID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, state)
}

func (h *LitigationHandler) StreamPleadingGeneration(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	pleadingID, ok := h.uuidParam(w, r, "pleadingId")
	if !ok {
		return
	}
	if _, ok := w.(http.Flusher); !ok {
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "STREAM_UNSUPPORTED", "", nil)
		return
	}
	state, events, unsubscribe, err := h.pleadings.SubscribePleadingGeneration(
		r.Context(), tenantID, caseID, pleadingID,
	)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	h.streamPleadingGeneration(w, r, http.StatusOK, state, events, unsubscribe)
}

func (h *LitigationHandler) CancelPleadingGeneration(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	pleadingID, ok := h.uuidParam(w, r, "pleadingId")
	if !ok {
		return
	}
	state, err := h.pleadings.CancelPleadingGeneration(r.Context(), tenantID, caseID, pleadingID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, state)
}

func (h *LitigationHandler) streamPleadingGeneration(
	w http.ResponseWriter,
	r *http.Request,
	status int,
	state *service.PleadingGenerationState,
	events <-chan service.PleadingGenerationEvent,
	unsubscribe func(),
) {
	defer unsubscribe()
	flusher := w.(http.Flusher)
	headers := w.Header()
	headers.Set("Content-Type", "text/event-stream; charset=utf-8")
	headers.Set("Cache-Control", "no-cache, no-transform")
	headers.Set("Connection", "keep-alive")
	headers.Set("X-Accel-Buffering", "no")
	w.WriteHeader(status)
	writePleadingGenerationSSE(w, flusher, "job", state)

	keepAlive := time.NewTicker(15 * time.Second)
	defer keepAlive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepAlive.C:
			fmt.Fprint(w, ": keep-alive\n\n")
			flusher.Flush()
		case event, open := <-events:
			if !open {
				fmt.Fprint(w, "event: done\ndata: {}\n\n")
				flusher.Flush()
				return
			}
			writePleadingGenerationSSE(w, flusher, event.Type, event.Data)
		}
	}
}

func writePleadingGenerationSSE(w http.ResponseWriter, flusher http.Flusher, event string, data any) {
	payload, err := json.Marshal(data)
	if err != nil {
		payload = []byte(`{"code":"STREAM_ENCODING_FAILED"}`)
		event = "generation_failed"
	}
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, payload)
	flusher.Flush()
}

func (h *LitigationHandler) ListPleadings(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, pleadingSortColumns, "updated_at", "desc")
	filters := model.LegalPleadingListFilters{
		Page:          page,
		PerPage:       perPage,
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}
	if v := strings.TrimSpace(r.URL.Query().Get("status")); v != "" {
		value := model.PleadingStatus(v)
		filters.Status = &value
	}
	if v := strings.TrimSpace(r.URL.Query().Get("type")); v != "" {
		value := model.PleadingType(v)
		filters.Type = &value
	}
	items, total, err := h.pleadings.ListPleadings(r.Context(), tenantID, caseID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *LitigationHandler) GetPleading(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	pleadingID, ok := h.uuidParam(w, r, "pleadingId")
	if !ok {
		return
	}
	item, err := h.pleadings.GetPleading(r.Context(), tenantID, caseID, pleadingID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LitigationHandler) UpdatePleading(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	pleadingID, ok := h.uuidParam(w, r, "pleadingId")
	if !ok {
		return
	}
	var req dto.UpdatePleadingRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.pleadings.UpdatePleadingDraft(r.Context(), tenantID, userID, caseID, pleadingID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LitigationHandler) DeletePleading(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	pleadingID, ok := h.uuidParam(w, r, "pleadingId")
	if !ok {
		return
	}
	if err := h.pleadings.DeletePleading(r.Context(), tenantID, caseID, pleadingID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LitigationHandler) AddPleadingAttachment(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	pleadingID, ok := h.uuidParam(w, r, "pleadingId")
	if !ok {
		return
	}
	var req dto.AddPleadingAttachmentRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.pleadings.AddPleadingAttachment(r.Context(), tenantID, userID, caseID, pleadingID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LitigationHandler) SubmitPleading(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	pleadingID, ok := h.uuidParam(w, r, "pleadingId")
	if !ok {
		return
	}
	item, err := h.pleadings.SubmitPleadingForApproval(r.Context(), tenantID, userID, caseID, pleadingID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LitigationHandler) DecidePleading(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	pleadingID, ok := h.uuidParam(w, r, "pleadingId")
	if !ok {
		return
	}
	workflowID, ok := h.uuidParam(w, r, "workflowInstanceID")
	if !ok {
		return
	}
	taskID, ok := h.uuidParam(w, r, "taskID")
	if !ok {
		return
	}
	var req dto.WorkflowDecisionRequest
	if !decodeBody(w, r, &req) {
		return
	}
	outcome, err := h.pleadings.DecidePleadingApproval(r.Context(), tenantID, userID, caseID, pleadingID, workflowID, taskID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, outcome)
}

func (h *LitigationHandler) FilePleading(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	pleadingID, ok := h.uuidParam(w, r, "pleadingId")
	if !ok {
		return
	}
	var req dto.FilePleadingRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.pleadings.FilePleading(r.Context(), tenantID, userID, caseID, pleadingID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// ============================================================================
// Hearing reports (CAP-056..059)
// ============================================================================

func (h *LitigationHandler) CreateHearingReport(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	hearingID, ok := h.uuidParam(w, r, "hearingId")
	if !ok {
		return
	}
	var req dto.CreateHearingReportRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.pleadings.CreateHearingReport(r.Context(), tenantID, userID, caseID, hearingID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LitigationHandler) ListHearingReports(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	hearingID, ok := h.uuidParam(w, r, "hearingId")
	if !ok {
		return
	}
	items, err := h.pleadings.ListHearingReports(r.Context(), tenantID, hearingID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *LitigationHandler) UpdateHearingReport(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	hearingID, ok := h.uuidParam(w, r, "hearingId")
	if !ok {
		return
	}
	reportID, ok := h.uuidParam(w, r, "reportId")
	if !ok {
		return
	}
	var req dto.UpdateHearingReportRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.pleadings.UpdateHearingReport(r.Context(), tenantID, userID, hearingID, reportID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LitigationHandler) DeleteHearingReport(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	hearingID, ok := h.uuidParam(w, r, "hearingId")
	if !ok {
		return
	}
	reportID, ok := h.uuidParam(w, r, "reportId")
	if !ok {
		return
	}
	if err := h.pleadings.DeleteHearingReport(r.Context(), tenantID, hearingID, reportID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ============================================================================
// Experts (CAP-060..062)
// ============================================================================

func (h *LitigationHandler) CreateExpert(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	var req dto.CreateExpertAssignmentRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.pleadings.CreateExpertAssignment(r.Context(), tenantID, userID, caseID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LitigationHandler) ListExperts(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, expertSortColumns, "updated_at", "desc")
	filters := model.LegalExpertAssignmentListFilters{
		Page:          page,
		PerPage:       perPage,
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}
	if v := strings.TrimSpace(r.URL.Query().Get("status")); v != "" {
		value := model.ExpertAssignmentStatus(v)
		filters.Status = &value
	}
	items, total, err := h.pleadings.ListExpertAssignments(r.Context(), tenantID, caseID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *LitigationHandler) GetExpert(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	expertID, ok := h.uuidParam(w, r, "expertId")
	if !ok {
		return
	}
	item, err := h.pleadings.GetExpertAssignment(r.Context(), tenantID, caseID, expertID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LitigationHandler) UpdateExpert(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	expertID, ok := h.uuidParam(w, r, "expertId")
	if !ok {
		return
	}
	var req dto.UpdateExpertAssignmentRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.pleadings.UpdateExpertAssignment(r.Context(), tenantID, userID, caseID, expertID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LitigationHandler) DeleteExpert(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	expertID, ok := h.uuidParam(w, r, "expertId")
	if !ok {
		return
	}
	if err := h.pleadings.DeleteExpertAssignment(r.Context(), tenantID, caseID, expertID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LitigationHandler) AddExpertDocument(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	expertID, ok := h.uuidParam(w, r, "expertId")
	if !ok {
		return
	}
	var req dto.AddExpertDocumentRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.pleadings.AddExpertDocument(r.Context(), tenantID, userID, caseID, expertID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// ============================================================================
// Judgments (CAP-063..066)
// ============================================================================

func (h *LitigationHandler) CreateJudgment(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	var req dto.CreateJudgmentRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.judgments.RecordJudgment(r.Context(), tenantID, userID, caseID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LitigationHandler) ListJudgments(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, judgmentSortColumns, "updated_at", "desc")
	filters := model.LegalJudgmentListFilters{
		Page:          page,
		PerPage:       perPage,
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}
	if v := strings.TrimSpace(r.URL.Query().Get("recommendation")); v != "" {
		value := model.JudgmentRecommendation(v)
		filters.Recommendation = &value
	}
	items, total, err := h.judgments.ListJudgments(r.Context(), tenantID, caseID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *LitigationHandler) GetJudgment(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	judgmentID, ok := h.uuidParam(w, r, "judgmentId")
	if !ok {
		return
	}
	item, err := h.judgments.GetJudgment(r.Context(), tenantID, caseID, judgmentID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LitigationHandler) StudyJudgment(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	judgmentID, ok := h.uuidParam(w, r, "judgmentId")
	if !ok {
		return
	}
	var req dto.StudyJudgmentRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.judgments.StudyJudgment(r.Context(), tenantID, userID, caseID, judgmentID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LitigationHandler) DeleteJudgment(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	judgmentID, ok := h.uuidParam(w, r, "judgmentId")
	if !ok {
		return
	}
	if err := h.judgments.DeleteJudgment(r.Context(), tenantID, caseID, judgmentID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ============================================================================
// Defendant flows (CAP-067..073)
// ============================================================================

func (h *LitigationHandler) RegisterDefendant(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	var req dto.RegisterDefendantCaseRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.defendants.Register(r.Context(), tenantID, userID, caseID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LitigationHandler) ListDefendant(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, defendantSortColumns, "updated_at", "desc")
	filters := model.LegalDefendantCaseListFilters{
		Page:          page,
		PerPage:       perPage,
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}
	if v := strings.TrimSpace(r.URL.Query().Get("status")); v != "" {
		value := model.DefendantCaseStatus(v)
		filters.Status = &value
	}
	items, total, err := h.defendants.List(r.Context(), tenantID, caseID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *LitigationHandler) GetDefendant(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	defendantID, ok := h.uuidParam(w, r, "defendantId")
	if !ok {
		return
	}
	item, err := h.defendants.Get(r.Context(), tenantID, caseID, defendantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LitigationHandler) UpdateDefendant(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	defendantID, ok := h.uuidParam(w, r, "defendantId")
	if !ok {
		return
	}
	var req dto.UpdateDefendantCaseRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.defendants.Update(r.Context(), tenantID, userID, caseID, defendantID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LitigationHandler) DeleteDefendant(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	defendantID, ok := h.uuidParam(w, r, "defendantId")
	if !ok {
		return
	}
	if err := h.defendants.Delete(r.Context(), tenantID, caseID, defendantID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LitigationHandler) SetNajizRepresentative(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	defendantID, ok := h.uuidParam(w, r, "defendantId")
	if !ok {
		return
	}
	var req dto.SetNajizRepresentativeRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.defendants.SetNajizRepresentative(r.Context(), tenantID, userID, caseID, defendantID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// SyncNajizCase performs the READ-first Najiz portal pull for a defendant case
// (POST /legal-cases/{id}/defendant/{defendantId}/najiz/sync). WRITE tier: it
// reconciles the local row. Returns an honest not-synced outcome (never faked
// success) when no Najiz endpoint is wired/configured.
func (h *LitigationHandler) SyncNajizCase(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	defendantID, ok := h.uuidParam(w, r, "defendantId")
	if !ok {
		return
	}
	outcome, err := h.defendants.SyncNajizCase(r.Context(), tenantID, userID, caseID, defendantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, outcome)
}

// NajizCourtHealth reports the honest connectivity verdict for the tenant's Najiz
// wiring (GET /legal-cases/{id}/defendant/{defendantId}/najiz/health). READ tier.
// Never fabricates live MoJ success: reports not_configured/planned/read_only/
// read_write. The path ids are accepted for route symmetry but the verdict is
// tenant-scoped (per-tenant endpoint config), so no case load is required.
func (h *LitigationHandler) NajizCourtHealth(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	health := h.defendants.NajizCourtHealth(r.Context(), tenantID)
	suiteapi.WriteData(w, http.StatusOK, health)
}

func (h *LitigationHandler) AddDefendantAttachment(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	defendantID, ok := h.uuidParam(w, r, "defendantId")
	if !ok {
		return
	}
	var req dto.AddDefendantAttachmentRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.defendants.AddAttachment(r.Context(), tenantID, userID, caseID, defendantID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LitigationHandler) NotifyDepartment(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	defendantID, ok := h.uuidParam(w, r, "defendantId")
	if !ok {
		return
	}
	var req dto.NotifyDepartmentRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.defendants.NotifyDepartment(r.Context(), tenantID, userID, caseID, defendantID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LitigationHandler) DraftResponseMemo(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	defendantID, ok := h.uuidParam(w, r, "defendantId")
	if !ok {
		return
	}
	var req dto.DraftResponseMemoRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.defendants.DraftResponseMemo(r.Context(), tenantID, userID, caseID, defendantID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LitigationHandler) StartResponseReview(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	defendantID, ok := h.uuidParam(w, r, "defendantId")
	if !ok {
		return
	}
	var req dto.StartResponseReviewRequest
	if !decodeBody(w, r, &req) {
		return
	}
	item, err := h.defendants.StartResponseReview(r.Context(), tenantID, userID, caseID, defendantID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LitigationHandler) DecideResponseReview(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, ok := h.uuidParam(w, r, "id")
	if !ok {
		return
	}
	defendantID, ok := h.uuidParam(w, r, "defendantId")
	if !ok {
		return
	}
	workflowID, ok := h.uuidParam(w, r, "workflowInstanceID")
	if !ok {
		return
	}
	taskID, ok := h.uuidParam(w, r, "taskID")
	if !ok {
		return
	}
	var req dto.WorkflowDecisionRequest
	if !decodeBody(w, r, &req) {
		return
	}
	outcome, err := h.defendants.DecideResponseReview(r.Context(), tenantID, userID, caseID, defendantID, workflowID, taskID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, outcome)
}

// ---- shared handler helpers ------------------------------------------------

// uuidParam parses a chi URL param into a uuid, writing a 400 on failure.
func (h *LitigationHandler) uuidParam(w http.ResponseWriter, r *http.Request, key string) (uuid.UUID, bool) {
	id, err := suiteapi.UUIDParam(r, key)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return id, false
	}
	return id, true
}

// decodeBody decodes the JSON body, writing a 400 on failure.
func decodeBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := suiteapi.DecodeJSON(r, dst); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return false
	}
	return true
}
