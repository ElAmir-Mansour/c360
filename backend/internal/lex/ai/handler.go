package ai

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/suiteapi"
)

// ChatService is the service contract the HTTP adapter depends on (satisfied by
// *Service). Declared as an interface so the handler is testable in isolation.
type ChatService interface {
	Chat(ctx context.Context, in ChatInput) (*ChatResult, error)
	ListSessions(ctx context.Context, tenantID, userID uuid.UUID, limit int) (*SessionList, error)
	GetSession(ctx context.Context, tenantID, userID, sessionID uuid.UUID) (*SessionTranscript, error)
}

// Handler maps HTTP to the assistant service. It follows the Lex handler idiom
// (suiteapi tenant/user extraction, suiteapi.WriteData / WriteError).
type Handler struct {
	svc    ChatService
	logger zerolog.Logger
}

// NewHandler constructs the assistant HTTP handler.
func NewHandler(svc ChatService, logger zerolog.Logger) *Handler {
	return &Handler{svc: svc, logger: logger.With().Str("handler", "lex-ai").Logger()}
}

type chatRequest struct {
	SessionID *string `json:"session_id"`
	Message   string  `json:"message"`
}

// Chat handles POST /ai/chat.
func (h *Handler) Chat(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req chatRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	sessionID, err := parseOptionalUUID(req.SessionID)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "session_id must be a UUID", nil)
		return
	}
	result, err := h.svc.Chat(r.Context(), ChatInput{
		TenantID:  tenantID,
		UserID:    userID,
		SessionID: sessionID,
		Message:   req.Message,
		Grants:    GrantsFromRequest(r),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

// ListSessions handles GET /ai/sessions.
func (h *Handler) ListSessions(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	limit := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "limit must be a positive integer", nil)
			return
		}
		limit = parsed
	}
	list, err := h.svc.ListSessions(r.Context(), tenantID, userID, limit)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, list)
}

// GetSession handles GET /ai/sessions/{sessionID}.
func (h *Handler) GetSession(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	sessionID, err := suiteapi.UUIDParam(r, "sessionID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "sessionID must be a UUID", nil)
		return
	}
	transcript, err := h.svc.GetSession(r.Context(), tenantID, userID, sessionID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, transcript)
}

// GrantsFromRequest resolves the caller's effective legal-domain read access
// from the request context, using the same permission keys that gate the
// equivalent REST surfaces (see handler.workforceForbiddenDomains). Holding
// lex:ai:use therefore grants access to the assistant, never to data.
func GrantsFromRequest(r *http.Request) Grants {
	ctx := r.Context()
	roles := []string{}
	if user := auth.UserFromContext(ctx); user != nil {
		roles = user.Roles
	}
	return Grants{
		Contracts:     auth.HasPermissionCtx(ctx, roles, auth.PermLexContractView),
		Cases:         auth.HasPermissionCtx(ctx, roles, auth.PermLexCaseView),
		Consultations: auth.HasPermissionCtx(ctx, roles, auth.PermLexConsultationView),
		Requests:      auth.HasPermissionCtx(ctx, roles, auth.PermLexRequestView),
		Workforce:     auth.HasPermissionCtx(ctx, roles, auth.PermLexWorkforceRead),
	}
}

func (h *Handler) tenantAndUser(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	userID, err := suiteapi.UserID(r)
	if err != nil || userID == nil {
		message := "authentication required"
		if err != nil {
			message = err.Error()
		}
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", message, nil)
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, *userID, true
}

func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "NOT_FOUND", err.Error(), nil)
	case errors.Is(err, ErrEmptyMessage), errors.Is(err, ErrMessageTooLong):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
	case errors.Is(err, ErrNoGroundingAccess):
		suiteapi.WriteError(w, r, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
	case errors.Is(err, ErrAnswerRefused):
		suiteapi.WriteError(w, r, http.StatusUnprocessableEntity, "AI_REFUSED", err.Error(), nil)
	case errors.Is(err, ErrProviderUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "AI_UNAVAILABLE", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("lex ai request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "internal server error", nil)
	}
}

func parseOptionalUUID(raw *string) (*uuid.UUID, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, nil
	}
	id, err := uuid.Parse(strings.TrimSpace(*raw))
	if err != nil {
		return nil, err
	}
	return &id, nil
}
