package admin

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
)

type Handler struct {
	svc *Service
}

func NewParsersRouter(svc *Service) chi.Router {
	r := chi.NewRouter()
	h := &Handler{svc: svc}
	r.Get("/", h.ListParsers)
	r.Post("/", h.CreateParser)
	r.Get("/{id}", h.GetParser)
	r.Patch("/{id}", h.UpdateParser)
	r.Post("/{id}/promote", h.PromoteParser)
	r.Post("/{id}/retire", h.RetireParser)
	return r
}

func NewSettingsRouter(svc *Service) chi.Router {
	r := chi.NewRouter()
	h := &Handler{svc: svc}
	r.Get("/", h.GetSettings)
	r.Put("/", h.UpdateSettings)
	return r
}

type parserCreateReq struct {
	Name       string          `json:"name"`
	SourceType string          `json:"source_type"`
	Version    string          `json:"version"`
	ECSVersion string          `json:"ecs_version"`
	Config     json.RawMessage `json:"config"`
	Fixtures   json.RawMessage `json:"fixtures"`
}

type parserPatchReq struct {
	Name       *string          `json:"name,omitempty"`
	SourceType *string          `json:"source_type,omitempty"`
	Version    *string          `json:"version,omitempty"`
	ECSVersion *string          `json:"ecs_version,omitempty"`
	Config     *json.RawMessage `json:"config,omitempty"`
	Fixtures   *json.RawMessage `json:"fixtures,omitempty"`
}

type settingsReq struct {
	RetentionDays    *int  `json:"retention_days,omitempty"`
	ParserCIRequired *bool `json:"parser_ci_required,omitempty"`
	HSMRequired      *bool `json:"hsm_required,omitempty"`
	WarmTierDays     *int  `json:"warm_tier_days,omitempty"`
	ColdTierEnabled  *bool `json:"cold_tier_enabled,omitempty"`
}

func (h *Handler) CreateParser(w http.ResponseWriter, r *http.Request) {
	tenantID, actorID, ok := h.contextIDs(w, r)
	if !ok {
		return
	}
	var req parserCreateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json", err.Error())
		return
	}
	parser, err := h.svc.CreateParser(r.Context(), ParserCreateInput{
		TenantID: tenantID, Name: req.Name, SourceType: req.SourceType,
		Version: req.Version, ECSVersion: req.ECSVersion, Config: req.Config,
		Fixtures: req.Fixtures, CreatedBy: actorID,
	})
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, parser)
}

func (h *Handler) GetParser(w http.ResponseWriter, r *http.Request) {
	tenantID, _, ok := h.contextIDs(w, r)
	if !ok {
		return
	}
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	parser, err := h.svc.GetParser(r.Context(), tenantID, id)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, parser)
}

func (h *Handler) ListParsers(w http.ResponseWriter, r *http.Request) {
	tenantID, _, ok := h.contextIDs(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	lq := ParserListQuery{}
	if status := q.Get("status"); status != "" {
		st := ParserStatus(status)
		lq.Status = &st
	}
	if sourceType := q.Get("source_type"); sourceType != "" {
		lq.SourceType = &sourceType
	}
	if limit := q.Get("limit"); limit != "" {
		n, err := strconv.Atoi(limit)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "bad_limit", "limit must be an integer")
			return
		}
		lq.Limit = n
	}
	items, err := h.svc.ListParsers(r.Context(), tenantID, lq)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) UpdateParser(w http.ResponseWriter, r *http.Request) {
	tenantID, _, ok := h.contextIDs(w, r)
	if !ok {
		return
	}
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var req parserPatchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json", err.Error())
		return
	}
	parser, err := h.svc.UpdateParser(r.Context(), tenantID, id, ParserUpdateInput{
		Name: req.Name, SourceType: req.SourceType, Version: req.Version,
		ECSVersion: req.ECSVersion, Config: req.Config, Fixtures: req.Fixtures,
	})
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, parser)
}

func (h *Handler) PromoteParser(w http.ResponseWriter, r *http.Request) {
	tenantID, _, ok := h.contextIDs(w, r)
	if !ok {
		return
	}
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	parser, err := h.svc.PromoteParser(r.Context(), tenantID, id)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, parser)
}

func (h *Handler) RetireParser(w http.ResponseWriter, r *http.Request) {
	tenantID, _, ok := h.contextIDs(w, r)
	if !ok {
		return
	}
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	parser, err := h.svc.RetireParser(r.Context(), tenantID, id)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, parser)
}

func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	tenantID, _, ok := h.contextIDs(w, r)
	if !ok {
		return
	}
	settings, err := h.svc.GetSettings(r.Context(), tenantID)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	tenantID, actorID, ok := h.contextIDs(w, r)
	if !ok {
		return
	}
	current, err := h.svc.GetSettings(r.Context(), tenantID)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	var req settingsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json", err.Error())
		return
	}
	input := SettingsInput{
		TenantID: tenantID, RetentionDays: current.RetentionDays,
		ParserCIRequired: current.ParserCIRequired, HSMRequired: current.HSMRequired,
		WarmTierDays: current.WarmTierDays, ColdTierEnabled: current.ColdTierEnabled,
		UpdatedBy: actorID,
	}
	if req.RetentionDays != nil {
		input.RetentionDays = *req.RetentionDays
	}
	if req.ParserCIRequired != nil {
		input.ParserCIRequired = *req.ParserCIRequired
	}
	if req.HSMRequired != nil {
		input.HSMRequired = *req.HSMRequired
	}
	if req.WarmTierDays != nil {
		input.WarmTierDays = *req.WarmTierDays
	}
	if req.ColdTierEnabled != nil {
		input.ColdTierEnabled = *req.ColdTierEnabled
	}
	settings, err := h.svc.UpdateSettings(r.Context(), input)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (h *Handler) contextIDs(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	if h == nil || h.svc == nil {
		writeErr(w, http.StatusInternalServerError, "not_configured", "siem admin service is not configured")
		return uuid.Nil, uuid.Nil, false
	}
	tenant := auth.TenantFromContext(r.Context())
	if tenant == "" {
		writeErr(w, http.StatusBadRequest, "bad_tenant", "missing tenant id")
		return uuid.Nil, uuid.Nil, false
	}
	tenantID, err := uuid.Parse(tenant)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_tenant", "tenant id must be a UUID")
		return uuid.Nil, uuid.Nil, false
	}
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeErr(w, http.StatusUnauthorized, "unauthenticated", "authentication required")
		return uuid.Nil, uuid.Nil, false
	}
	actorID, err := uuid.Parse(user.ID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_actor", "user id must be a UUID")
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, actorID, true
}

func urlUUID(w http.ResponseWriter, r *http.Request, key string) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, key))
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "resource not found")
		return uuid.Nil, false
	}
	return id, true
}

func writeAdminErr(w http.ResponseWriter, err error) {
	var fe *FieldErrors
	switch {
	case errors.As(err, &fe):
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"status": 400, "code": "validation_failed",
			"message": fe.Error(), "errors": fe.Errors,
		})
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, "not_found", "resource not found")
	case errors.Is(err, ErrConflict):
		writeErr(w, http.StatusConflict, "conflict", err.Error())
	case errors.Is(err, ErrInvalidState):
		writeErr(w, http.StatusConflict, "invalid_state", err.Error())
	case errors.Is(err, ErrValidation):
		writeErr(w, http.StatusBadRequest, "validation_failed", err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "internal", fmt.Sprintf("internal error: %v", err))
	}
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"status": status, "code": code, "message": msg})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
