package handler

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

type ManagerTaskHandler struct {
	baseHandler
	service *service.ManagerTaskService
}

func NewManagerTaskHandler(svc *service.ManagerTaskService, logger zerolog.Logger) *ManagerTaskHandler {
	return &ManagerTaskHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

func (h *ManagerTaskHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateManagerTaskRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Create(r.Context(), tenantID, userID, rolesFromContext(r), req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *ManagerTaskHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	filters := model.ManagerTaskListFilters{Page: page, PerPage: perPage}
	if raw := r.URL.Query().Get("status"); raw != "" {
		status := model.ManagerTaskStatus(raw)
		if !status.Valid() {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid task status", nil)
			return
		}
		filters.Status = &status
	}
	if raw := r.URL.Query().Get("assignee_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid assignee_id", nil)
			return
		}
		filters.AssigneeID = &id
	}
	items, total, err := h.service.List(r.Context(), tenantID, userID, rolesFromContext(r), filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *ManagerTaskHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, id, ok := h.ids(w, r)
	if !ok {
		return
	}
	item, err := h.service.Get(r.Context(), tenantID, userID, rolesFromContext(r), id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ManagerTaskHandler) Start(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, id, ok := h.ids(w, r)
	if !ok {
		return
	}
	item, err := h.service.Start(r.Context(), tenantID, userID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ManagerTaskHandler) Submit(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, id, ok := h.ids(w, r)
	if !ok {
		return
	}
	var req dto.SubmitManagerTaskRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Submit(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ManagerTaskHandler) Decide(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, id, ok := h.ids(w, r)
	if !ok {
		return
	}
	var req dto.DecideManagerTaskRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Decide(r.Context(), tenantID, userID, id, rolesFromContext(r), req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ManagerTaskHandler) ids(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, uuid.UUID, bool) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	return tenantID, userID, id, true
}
