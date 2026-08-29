package handler

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

var serviceCatalogSortColumns = map[string]string{
	"code":         "s.code",
	"request_type": "s.request_type",
	"channel":      "s.channel",
	"active":       "s.active",
	"updated_at":   "s.updated_at",
	"created_at":   "s.created_at",
}

type ServiceCatalogHandler struct {
	baseHandler
	service *service.ServiceCatalogService
}

func NewServiceCatalogHandler(service *service.ServiceCatalogService, logger zerolog.Logger) *ServiceCatalogHandler {
	return &ServiceCatalogHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

func (h *ServiceCatalogHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateServiceCatalogRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Create(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *ServiceCatalogHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseServiceCatalogListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, total, err := h.service.List(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *ServiceCatalogHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.Get(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ServiceCatalogHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateServiceCatalogRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Update(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ServiceCatalogHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.Delete(r.Context(), tenantID, userID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ServiceCatalogHandler) CheckEligibility(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.EligibilityCheckRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	decision, err := h.service.CheckEligibility(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, decision)
}

func parseServiceCatalogListFilters(r *http.Request) (model.ServiceCatalogListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, serviceCatalogSortColumns, "updated_at", "desc")
	filters := model.ServiceCatalogListFilters{
		Page:          page,
		PerPage:       perPage,
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		RequestType:   strings.TrimSpace(r.URL.Query().Get("request_type")),
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}
	channels := r.URL.Query()["channel"]
	if len(channels) > 1 {
		for _, channel := range channels {
			if value := strings.TrimSpace(channel); value != "" {
				filters.Channels = append(filters.Channels, model.ServiceChannel(value))
			}
		}
	} else if channel := strings.TrimSpace(r.URL.Query().Get("channel")); channel != "" {
		value := model.ServiceChannel(channel)
		filters.Channel = &value
	}
	if active := strings.TrimSpace(r.URL.Query().Get("active")); active != "" {
		parsed, parseErr := strconv.ParseBool(active)
		if parseErr != nil {
			return model.ServiceCatalogListFilters{}, fmt.Errorf("invalid active")
		}
		filters.Active = &parsed
	}
	return filters, nil
}
