package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/siem/sources"
	siemmw "github.com/clario360/platform/internal/siem/sources/middleware"
	"github.com/clario360/platform/internal/siem/sources/service"
)

// SourcesHandler hosts CRUD + lifecycle handlers.
type SourcesHandler struct {
	d Deps
}

// NewSourcesHandler constructs a SourcesHandler.
func NewSourcesHandler(d Deps) *SourcesHandler { return &SourcesHandler{d: d} }

type createReq struct {
	Name        string          `json:"name"`
	Type        string          `json:"type"`
	Transport   string          `json:"transport"`
	Address     string          `json:"address"`
	ExpectedEPS int             `json:"expected_eps"`
	TZ          string          `json:"tz"`
	Tags        json.RawMessage `json:"tags"`
}

type updateReq struct {
	Type        *string         `json:"type,omitempty"`
	Address     *string         `json:"address,omitempty"`
	ExpectedEPS *int            `json:"expected_eps,omitempty"`
	TZ          *string         `json:"tz,omitempty"`
	Tags        json.RawMessage `json:"tags,omitempty"`
}

type disableReq struct {
	Reason string `json:"reason"`
}

type rotateReq struct {
	Force bool `json:"force"`
}

// Create POST /api/v1/siem/sources
func (h *SourcesHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, err := tenantUUID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_tenant", err.Error())
		return
	}
	actor := actorUUID(r)
	var in createReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json", err.Error())
		return
	}
	src, tok, err := h.d.Service.Onboard(r.Context(), sources.OnboardInput{
		TenantID: tenantID, Name: in.Name, Type: in.Type,
		Transport: sources.Transport(in.Transport), Address: in.Address,
		ExpectedEPS: in.ExpectedEPS, TZ: in.TZ, Tags: in.Tags, CreatedBy: actor,
	})
	if err != nil {
		writeServiceErr(w, err)
		return
	}
	publishLifecycle(h.d.Hub, tenantID, "lifecycle", "created", src)
	writeJSON(w, http.StatusCreated, map[string]any{"source": src, "enrollment_token": tok})
}

// Get GET /api/v1/siem/sources/{id}
func (h *SourcesHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, err := tenantUUID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_tenant", err.Error())
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeNotFound(w)
		return
	}
	src, err := h.d.Service.Get(r.Context(), tenantID, id)
	if err != nil {
		writeServiceErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, src)
}

// List GET /api/v1/siem/sources
func (h *SourcesHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, err := tenantUUID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_tenant", err.Error())
		return
	}
	q := r.URL.Query()
	lq := sources.ListQuery{Q: q.Get("q"), Cursor: q.Get("cursor")}
	if s := q.Get("status"); s != "" {
		st := sources.Status(s)
		lq.Status = &st
	}
	if t := q.Get("type"); t != "" {
		lq.Type = &t
	}
	if tr := q.Get("transport"); tr != "" {
		tt := sources.Transport(tr)
		lq.Transport = &tt
	}
	if l := q.Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil {
			lq.Limit = n
		}
	}
	tags := map[string]string{}
	for k, v := range q {
		if strings.HasPrefix(k, "tag.") && len(v) > 0 {
			tags[strings.TrimPrefix(k, "tag.")] = v[0]
		}
	}
	if len(tags) > 0 {
		lq.Tags = tags
	}
	res, err := h.d.Service.List(r.Context(), tenantID, lq)
	if err != nil {
		writeServiceErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// Update PATCH /api/v1/siem/sources/{id}
func (h *SourcesHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, err := tenantUUID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_tenant", err.Error())
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeNotFound(w)
		return
	}
	v, ok := siemmw.IfMatchFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusBadRequest, "missing_if_match", "If-Match required")
		return
	}
	var in updateReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json", err.Error())
		return
	}
	ctx := service.WithActor(r.Context(), actorUUID(r))
	updated, err := h.d.Service.Update(ctx, tenantID, id, sources.UpdateInput{
		Type: in.Type, Address: in.Address, ExpectedEPS: in.ExpectedEPS,
		TZ: in.TZ, Tags: in.Tags,
	}, v)
	if err != nil {
		writeServiceErr(w, err)
		return
	}
	publishLifecycle(h.d.Hub, tenantID, "lifecycle", "updated", updated)
	writeJSON(w, http.StatusOK, updated)
}

// Delete DELETE /api/v1/siem/sources/{id}
func (h *SourcesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, err := tenantUUID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_tenant", err.Error())
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeNotFound(w)
		return
	}
	v, _ := siemmw.IfMatchFromContext(r.Context())
	ctx := service.WithActor(r.Context(), actorUUID(r))
	if err := h.d.Service.SoftDelete(ctx, tenantID, id, v); err != nil {
		writeServiceErr(w, err)
		return
	}
	publishLifecycle(h.d.Hub, tenantID, "lifecycle", "deleted", map[string]string{"id": id.String()})
	w.WriteHeader(http.StatusNoContent)
}

// Disable POST /api/v1/siem/sources/{id}/disable
func (h *SourcesHandler) Disable(w http.ResponseWriter, r *http.Request) {
	tenantID, err := tenantUUID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_tenant", err.Error())
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeNotFound(w)
		return
	}
	v, _ := siemmw.IfMatchFromContext(r.Context())
	var body disableReq
	_ = json.NewDecoder(r.Body).Decode(&body)
	ctx := service.WithActor(r.Context(), actorUUID(r))
	updated, err := h.d.Service.Disable(ctx, tenantID, id, body.Reason, v)
	if err != nil {
		writeServiceErr(w, err)
		return
	}
	publishLifecycle(h.d.Hub, tenantID, "lifecycle", "disabled", updated)
	writeJSON(w, http.StatusOK, updated)
}

// Enable POST /api/v1/siem/sources/{id}/enable
func (h *SourcesHandler) Enable(w http.ResponseWriter, r *http.Request) {
	tenantID, err := tenantUUID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_tenant", err.Error())
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeNotFound(w)
		return
	}
	v, _ := siemmw.IfMatchFromContext(r.Context())
	ctx := service.WithActor(r.Context(), actorUUID(r))
	updated, err := h.d.Service.Enable(ctx, tenantID, id, v)
	if err != nil {
		writeServiceErr(w, err)
		return
	}
	publishLifecycle(h.d.Hub, tenantID, "lifecycle", "enabled", updated)
	writeJSON(w, http.StatusOK, updated)
}

// RotateCert POST /api/v1/siem/sources/{id}/rotate-cert
func (h *SourcesHandler) RotateCert(w http.ResponseWriter, r *http.Request) {
	tenantID, err := tenantUUID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_tenant", err.Error())
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeNotFound(w)
		return
	}
	var body rotateReq
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Force {
		user := auth.UserFromContext(r.Context())
		if user == nil || !auth.HasPermission(user.Roles, "siem:admin") {
			writeErr(w, http.StatusForbidden, "forbidden", "force=true requires siem:admin")
			return
		}
	}
	v, _ := siemmw.IfMatchFromContext(r.Context())
	ctx := service.WithActor(r.Context(), actorUUID(r))
	tok, err := h.d.Service.RotateCert(ctx, tenantID, id, body.Force, v)
	if err != nil {
		writeServiceErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tok)
}

// ----- shared helpers -----

func tenantUUID(r *http.Request) (uuid.UUID, error) {
	s := auth.TenantFromContext(r.Context())
	if s == "" {
		return uuid.Nil, errors.New("missing tenant id")
	}
	return uuid.Parse(s)
}

func actorUUID(r *http.Request) uuid.UUID {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		return uuid.Nil
	}
	id, _ := uuid.Parse(user.ID)
	return id
}

func writeNotFound(w http.ResponseWriter) {
	// Identical body for unknown id and cross-tenant id to avoid
	// existence leakage.
	writeErr(w, http.StatusNotFound, "not_found", "source not found")
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "code": code, "message": msg})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeServiceErr(w http.ResponseWriter, err error) {
	var fe *sources.FieldErrors
	switch {
	case errors.As(err, &fe):
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"status": 400, "code": "validation_failed",
			"message": fe.Error(), "errors": fe.Errors,
		})
	case errors.Is(err, sources.ErrNotFound):
		writeNotFound(w)
	case errors.Is(err, sources.ErrConflict):
		writeErr(w, http.StatusConflict, "conflict", err.Error())
	case errors.Is(err, sources.ErrVersionMismatch):
		writeErr(w, http.StatusPreconditionFailed, "version_mismatch", err.Error())
	case errors.Is(err, sources.ErrTenantMismatch):
		writeErr(w, http.StatusForbidden, "tenant_mismatch", err.Error())
	case errors.Is(err, sources.ErrTokenConsumed):
		writeErr(w, http.StatusConflict, "token_consumed", err.Error())
	case errors.Is(err, sources.ErrTokenInvalid):
		writeErr(w, http.StatusUnauthorized, "invalid_token", err.Error())
	case errors.Is(err, sources.ErrInvalidState):
		writeErr(w, http.StatusConflict, "invalid_state", err.Error())
	case errors.Is(err, sources.ErrValidation):
		writeErr(w, http.StatusBadRequest, "validation_failed", err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "internal", fmt.Sprintf("internal error: %v", err))
	}
}

func publishLifecycle(hub HubPublisher, tenantID uuid.UUID, topicSuffix, evt string, payload any) {
	if hub == nil {
		return
	}
	msg, err := json.Marshal(map[string]any{"event": evt, "data": payload})
	if err != nil {
		return
	}
	topic := "siem.source." + topicSuffix + "." + tenantID.String()
	hub.Publish(tenantID.String(), topic, msg)
}
