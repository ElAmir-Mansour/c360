package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

var (
	errInvalidSubjectType = errors.New("invalid subject_type")
	errInvalidSubjectID   = errors.New("invalid subject_id")
	errInvalidStatus      = errors.New("invalid status")
)

var legalHoldSortColumns = map[string]string{
	"applied_at":   "applied_at",
	"released_at":  "released_at",
	"status":       "status",
	"subject_type": "subject_type",
	"created_at":   "created_at",
}

// LegalHoldHandler exposes the FR-WATHEEQ-005 legal-hold API. Apply/release
// require lex:write; list/get require lex:read (wired in routes.go).
type LegalHoldHandler struct {
	baseHandler
	service *service.LegalHoldService
}

func NewLegalHoldHandler(service *service.LegalHoldService, logger zerolog.Logger) *LegalHoldHandler {
	return &LegalHoldHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

// Apply places a legal hold on a contract, matter, or document.
func (h *LegalHoldHandler) Apply(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.ApplyLegalHoldRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	hold, err := h.service.ApplyHold(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, hold)
}

// Release lifts an active legal hold.
func (h *LegalHoldHandler) Release(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.ReleaseLegalHoldRequest
	// Release body is optional; ignore decode errors only for an empty body.
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
			return
		}
	}
	hold, err := h.service.ReleaseHold(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, hold)
}

// List returns a tenant-scoped, filtered, paginated set of holds.
func (h *LegalHoldHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseLegalHoldListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, total, err := h.service.ListHolds(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

// Get returns a single hold by id.
func (h *LegalHoldHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	hold, err := h.service.Get(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, hold)
}

func parseLegalHoldListFilters(r *http.Request) (model.LegalHoldListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, legalHoldSortColumns, "applied_at", "desc")

	filters := model.LegalHoldListFilters{
		Page:          page,
		PerPage:       perPage,
		Reference:     strings.TrimSpace(r.URL.Query().Get("reference")),
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}
	if subjectType := strings.TrimSpace(r.URL.Query().Get("subject_type")); subjectType != "" {
		value := model.LegalHoldSubjectType(subjectType)
		if !value.Valid() {
			return model.LegalHoldListFilters{}, errInvalidSubjectType
		}
		filters.SubjectType = &value
	}
	subjectID, err := parseOptionalUUID(r.URL.Query().Get("subject_id"))
	if err != nil {
		return model.LegalHoldListFilters{}, errInvalidSubjectID
	}
	filters.SubjectID = subjectID
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		switch model.LegalHoldStatus(status) {
		case model.LegalHoldStatusActive, model.LegalHoldStatusReleased:
			value := model.LegalHoldStatus(status)
			filters.Status = &value
		default:
			return model.LegalHoldListFilters{}, errInvalidStatus
		}
	}
	return filters, nil
}
