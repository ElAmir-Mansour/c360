package copilot

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// ChatService is the service contract the HTTP adapter depends on (satisfied by
// *Service). Declared as an interface so the handler is testable in isolation.
type ChatService interface {
	Chat(ctx context.Context, in ChatInput) (*ChatResult, error)
	GetSession(ctx context.Context, tenantID, sessionID uuid.UUID) (*SessionTranscript, error)
}

// Handler maps HTTP to the copilot service.
type Handler struct {
	svc    ChatService
	logger zerolog.Logger
}

// NewHandler constructs the copilot HTTP handler.
func NewHandler(svc ChatService, logger zerolog.Logger) *Handler {
	return &Handler{svc: svc, logger: logger.With().Str("handler", "dr_copilot").Logger()}
}

// Routes returns the copilot router. It is mounted by cmd/clario-dr-service
// alongside the rest of the DR API (e.g. under /api/v1/dr). The copilot only
// reads DR state and writes its own audit log, so both routes require dr:read;
// a proposed failover is a plan only and still requires the operator to perform
// the dr:failover-gated initiate + approve calls separately.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Post("/copilot/chat", h.chat)
		r.Get("/copilot/sessions/{sessionID}", h.getSession)
	})
	return r
}

// FailoverGatedRoutes returns the copilot router with the chat endpoint
// additionally gated by proposeGate. A chat turn can invoke the ProposeFailover
// tool (returning a failover plan), so the integration phase wires proposeGate
// as RequirePermission(dr:failover): only an operator who could initiate a
// failover may ask the copilot to draft one. Transcript reads stay at dr:read.
// proposeGate is applied on TOP of the dr:read gate, so the caller needs both.
func (h *Handler) FailoverGatedRoutes(proposeGate func(http.Handler) http.Handler) chi.Router {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/copilot/sessions/{sessionID}", h.getSession)

		r.Group(func(r chi.Router) {
			r.Use(proposeGate)
			r.Post("/copilot/chat", h.chat)
		})
	})
	return r
}

type chatRequest struct {
	SessionID *string `json:"session_id"`
	Message   string  `json:"message"`
}

func (h *Handler) chat(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	userID, ok := h.currentUserID(w, r)
	if !ok {
		return
	}
	var req chatRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	sessionID, err := h.parseOptionalUUID(req.SessionID)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	result, err := h.svc.Chat(r.Context(), ChatInput{
		TenantID:  tenantID,
		UserID:    userID,
		SessionID: sessionID,
		Message:   req.Message,
	})
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

func (h *Handler) getSession(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	sessionID, err := suiteapi.UUIDParam(r, "sessionID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	transcript, err := h.svc.GetSession(r.Context(), tenantID, sessionID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, transcript)
}

func (h *Handler) writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrEmptyMessage), errors.Is(err, ErrMessageTooLong):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, ErrProviderUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "llm_unavailable", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr copilot request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

func (h *Handler) tenantID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) currentUserID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	userID, err := suiteapi.UserID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "bad_user", err.Error(), nil)
		return uuid.Nil, false
	}
	if userID == nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_user", "authenticated user context required", nil)
		return uuid.Nil, false
	}
	return *userID, true
}

func (h *Handler) parseOptionalUUID(raw *string) (*uuid.UUID, error) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(*raw)
	if err != nil {
		return nil, errors.New("session_id must be a UUID")
	}
	return &id, nil
}
