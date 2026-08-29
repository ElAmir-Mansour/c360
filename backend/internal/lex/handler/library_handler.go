package handler

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

type LibraryHandler struct {
	baseHandler
	service *service.LibraryService
}

func NewLibraryHandler(service *service.LibraryService, logger zerolog.Logger) *LibraryHandler {
	return &LibraryHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

func (h *LibraryHandler) ListClauses(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	items, total, err := h.service.ListClauses(r.Context(), tenantID, model.ClauseLibraryListFilters{
		Search:           searchQueryParam(r),
		ClauseType:       strings.TrimSpace(r.URL.Query().Get("clause_type")),
		Category:         strings.TrimSpace(r.URL.Query().Get("category")),
		Jurisdiction:     strings.TrimSpace(r.URL.Query().Get("jurisdiction")),
		Status:           strings.TrimSpace(r.URL.Query().Get("status")),
		GovernanceStatus: strings.TrimSpace(r.URL.Query().Get("governance_status")),
		Page:             page,
		PerPage:          perPage,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *LibraryHandler) SearchClauses(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	items, total, err := h.service.SearchClauses(r.Context(), tenantID, model.ClauseLibrarySearchFilters{
		Query:            searchQueryParam(r),
		ClauseType:       strings.TrimSpace(r.URL.Query().Get("clause_type")),
		Category:         strings.TrimSpace(r.URL.Query().Get("category")),
		Jurisdiction:     strings.TrimSpace(r.URL.Query().Get("jurisdiction")),
		Status:           strings.TrimSpace(r.URL.Query().Get("status")),
		GovernanceStatus: strings.TrimSpace(r.URL.Query().Get("governance_status")),
		RiskLevel:        strings.TrimSpace(r.URL.Query().Get("risk_level")),
		Language:         strings.TrimSpace(r.URL.Query().Get("language")),
		Semantic:         boolQueryParam(r, "semantic"),
		Page:             page,
		PerPage:          perPage,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *LibraryHandler) CreateClause(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateClauseLibraryItemRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.CreateClause(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LibraryHandler) GetClause(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetClause(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LibraryHandler) UpdateClause(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateClauseLibraryItemRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpdateClause(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LibraryHandler) DecideClauseGovernance(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.LibraryGovernanceDecisionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.DecideClauseGovernance(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LibraryHandler) DeleteClause(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.DeleteClause(r.Context(), tenantID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) ListRegulations(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	items, total, err := h.service.ListRegulations(r.Context(), tenantID, model.RegulationLibraryListFilters{
		Search:         searchQueryParam(r),
		Jurisdiction:   strings.TrimSpace(r.URL.Query().Get("jurisdiction")),
		Authority:      strings.TrimSpace(r.URL.Query().Get("authority")),
		RegulationType: strings.TrimSpace(r.URL.Query().Get("regulation_type")),
		Status:         strings.TrimSpace(r.URL.Query().Get("status")),
		Page:           page,
		PerPage:        perPage,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *LibraryHandler) SearchRegulations(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	items, total, err := h.service.SearchRegulations(r.Context(), tenantID, model.RegulationLibrarySearchFilters{
		Query:          searchQueryParam(r),
		Jurisdiction:   strings.TrimSpace(r.URL.Query().Get("jurisdiction")),
		Authority:      strings.TrimSpace(r.URL.Query().Get("authority")),
		RegulationType: strings.TrimSpace(r.URL.Query().Get("regulation_type")),
		Status:         strings.TrimSpace(r.URL.Query().Get("status")),
		RiskLevel:      strings.TrimSpace(r.URL.Query().Get("risk_level")),
		Language:       strings.TrimSpace(r.URL.Query().Get("language")),
		Semantic:       boolQueryParam(r, "semantic"),
		Page:           page,
		PerPage:        perPage,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *LibraryHandler) CreateRegulation(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateRegulationLibraryItemRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.CreateRegulation(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LibraryHandler) GetRegulation(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetRegulation(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LibraryHandler) UpdateRegulation(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateRegulationLibraryItemRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpdateRegulation(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LibraryHandler) DecideRegulationGovernance(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.LibraryGovernanceDecisionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.DecideRegulationGovernance(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LibraryHandler) DeleteRegulation(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.DeleteRegulation(r.Context(), tenantID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) LinkRegulationClause(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	regulationID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateRegulationClauseReferenceRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.LinkRegulationClause(r.Context(), tenantID, userID, regulationID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LibraryHandler) UnlinkRegulationClause(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	regulationID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	clauseID, err := parseUUIDQuery(r, "clause_id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	referenceType := model.RegulationClauseReferenceType(strings.TrimSpace(r.URL.Query().Get("reference_type")))
	if err := h.service.UnlinkRegulationClause(r.Context(), tenantID, regulationID, clauseID, referenceType); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseUUIDQuery(r *http.Request, key string) (uuid.UUID, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return uuid.Nil, fmt.Errorf("missing %s query parameter", key)
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

func searchQueryParam(r *http.Request) string {
	if value := strings.TrimSpace(r.URL.Query().Get("q")); value != "" {
		return value
	}
	return strings.TrimSpace(r.URL.Query().Get("search"))
}

func boolQueryParam(r *http.Request, key string) bool {
	switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get(key))) {
	case "1", "true", "t", "yes", "y", "on":
		return true
	default:
		return false
	}
}
