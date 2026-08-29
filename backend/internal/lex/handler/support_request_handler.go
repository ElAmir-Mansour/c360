package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

type SupportRequestHandler struct {
	baseHandler
	service *service.SupportRequestService
}

func NewSupportRequestHandler(svc *service.SupportRequestService, logger zerolog.Logger) *SupportRequestHandler {
	return &SupportRequestHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

func (h *SupportRequestHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateSupportRequest
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

func (h *SupportRequestHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	filters, err := parseSupportRequestFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, total, err := h.service.List(r.Context(), tenantID, userID, supportOversee(r), filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *SupportRequestHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, id, ok := h.ids(w, r)
	if !ok {
		return
	}
	item, err := h.service.Get(r.Context(), tenantID, userID, id, supportOversee(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SupportRequestHandler) Directory(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	entityID, err := parseOptionalUUID(r.URL.Query().Get("entity_id"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "entity_id must be a UUID", nil)
		return
	}
	result, err := h.service.Directory(r.Context(), tenantID, userID, entityID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

func (h *SupportRequestHandler) PreviewExpiry(w http.ResponseWriter, r *http.Request) {
	tenantID, _, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	businessDays, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("business_days")))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "business_days must be a whole number", nil)
		return
	}
	result, err := h.service.PreviewExpiry(r.Context(), tenantID, businessDays)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	suiteapi.WriteData(w, http.StatusOK, result)
}

func (h *SupportRequestHandler) Accept(w http.ResponseWriter, r *http.Request) {
	h.transition(w, r, func(ctxTenant, actor, id uuid.UUID, _ string) (*model.SupportRequest, error) {
		return h.service.Accept(r.Context(), ctxTenant, actor, id)
	}, false)
}

func (h *SupportRequestHandler) Decline(w http.ResponseWriter, r *http.Request) {
	h.transition(w, r, func(tenant, actor, id uuid.UUID, note string) (*model.SupportRequest, error) {
		return h.service.Decline(r.Context(), tenant, actor, id, note)
	}, true)
}

func (h *SupportRequestHandler) Resolve(w http.ResponseWriter, r *http.Request) {
	h.transition(w, r, func(tenant, actor, id uuid.UUID, note string) (*model.SupportRequest, error) {
		return h.service.Resolve(r.Context(), tenant, actor, id, note)
	}, true)
}

func (h *SupportRequestHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	h.transition(w, r, func(tenant, actor, id uuid.UUID, _ string) (*model.SupportRequest, error) {
		return h.service.Cancel(r.Context(), tenant, actor, id)
	}, false)
}

// Approve and Reject are authorized by being the approver frozen on the row, not
// by a permission of their own: who approves for whom is org-chart data, and a
// new permission would have to be granted to every manager in every tenant to
// say the same thing less accurately.
func (h *SupportRequestHandler) Approve(w http.ResponseWriter, r *http.Request) {
	h.decision(w, r, func(tenant, actor, id uuid.UUID, note string) (*model.SupportRequest, error) {
		return h.service.Approve(r.Context(), tenant, actor, id, note)
	})
}

func (h *SupportRequestHandler) Reject(w http.ResponseWriter, r *http.Request) {
	h.decision(w, r, func(tenant, actor, id uuid.UUID, note string) (*model.SupportRequest, error) {
		return h.service.Reject(r.Context(), tenant, actor, id, note)
	})
}

// decision differs from transition in one way: the note is optional, so an empty
// body is accepted. A manager clicking Approve has nothing to say, and returning
// 400 for a missing "{}" would make the common case the failing one.
func (h *SupportRequestHandler) decision(
	w http.ResponseWriter,
	r *http.Request,
	mutate func(uuid.UUID, uuid.UUID, uuid.UUID, string) (*model.SupportRequest, error),
) {
	tenantID, userID, id, ok := h.ids(w, r)
	if !ok {
		return
	}
	var req dto.SupportRequestNote
	if err := suiteapi.DecodeJSON(r, &req); err != nil && !errors.Is(err, io.EOF) {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	req.Normalize()
	item, err := mutate(tenantID, userID, id, req.Note)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SupportRequestHandler) transition(
	w http.ResponseWriter,
	r *http.Request,
	mutate func(uuid.UUID, uuid.UUID, uuid.UUID, string) (*model.SupportRequest, error),
	withBody bool,
) {
	tenantID, userID, id, ok := h.ids(w, r)
	if !ok {
		return
	}
	note := ""
	if withBody {
		var req dto.SupportRequestNote
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
			return
		}
		req.Normalize()
		note = req.Note
	}
	item, err := mutate(tenantID, userID, id, note)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SupportRequestHandler) ids(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, uuid.UUID, bool) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "id must be a UUID", nil)
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	return tenantID, userID, id, true
}

func supportOversee(r *http.Request) bool {
	return auth.HasPermissionCtx(r.Context(), rolesFromContext(r), auth.PermLexSupportOversee)
}

func parseSupportRequestFilters(r *http.Request) (model.SupportRequestListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	filters := model.SupportRequestListFilters{
		Box:  model.SupportRequestBox(strings.ToLower(strings.TrimSpace(r.URL.Query().Get("box")))),
		Page: page, PerPage: perPage,
	}
	if filters.Box == "" {
		filters.Box = model.SupportBoxInbox
	}
	for _, raw := range r.URL.Query()["status"] {
		for _, value := range strings.Split(raw, ",") {
			if value = strings.ToLower(strings.TrimSpace(value)); value != "" {
				filters.Statuses = append(filters.Statuses, model.SupportRequestStatus(value))
			}
		}
	}
	entityID, err := parseOptionalUUID(r.URL.Query().Get("entity_id"))
	if err != nil {
		return filters, err
	}
	filters.EntityID = entityID
	if raw := strings.TrimSpace(r.URL.Query().Get("history")); raw != "" {
		filters.History, err = strconv.ParseBool(raw)
		if err != nil {
			return filters, err
		}
	}
	return filters, nil
}
