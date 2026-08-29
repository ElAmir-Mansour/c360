package handler

import (
	"html/template"
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
	"github.com/clario360/platform/internal/notification/repository"
	"github.com/clario360/platform/internal/notification/service"
	"github.com/clario360/platform/internal/notification/unsubscribe"
)

// UnsubscribeHandler serves the public, token-verified one-click unsubscribe
// endpoint referenced by the RFC 8058 List-Unsubscribe email headers (#17). It
// carries NO auth middleware: trust is established solely by the HMAC-signed
// token, so possession of a valid token is the credential.
type UnsubscribeHandler struct {
	secret       string
	suppressRepo *repository.SuppressionRepository
	prefSvc      *service.PreferenceService
	logger       zerolog.Logger
}

// NewUnsubscribeHandler creates a new UnsubscribeHandler. secret must match the
// signing secret used by the email channel to mint tokens.
func NewUnsubscribeHandler(secret string, suppressRepo *repository.SuppressionRepository, prefSvc *service.PreferenceService, logger zerolog.Logger) *UnsubscribeHandler {
	return &UnsubscribeHandler{
		secret:       secret,
		suppressRepo: suppressRepo,
		prefSvc:      prefSvc,
		logger:       logger.With().Str("component", "unsubscribe_handler").Logger(),
	}
}

// OneClick handles POST .../unsubscribe — the RFC 8058 List-Unsubscribe-Post
// one-click action. The mail client POSTs "List-Unsubscribe=One-Click" with no
// human interaction, so the action must be idempotent and require no auth beyond
// the signed token.
func (h *UnsubscribeHandler) OneClick(w http.ResponseWriter, r *http.Request) {
	h.process(w, r)
}

// Confirm handles GET .../unsubscribe when a human follows the link (mail
// clients without one-click support). It performs the same suppression and
// renders a small confirmation page.
func (h *UnsubscribeHandler) Confirm(w http.ResponseWriter, r *http.Request) {
	h.process(w, r)
}

func (h *UnsubscribeHandler) process(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		token = r.FormValue("token")
	}

	claims, err := unsubscribe.Verify(h.secret, token)
	if err != nil {
		h.logger.Warn().Err(err).Msg("invalid unsubscribe token")
		writeUnsubscribeResult(w, http.StatusBadRequest, "This unsubscribe link is invalid or has expired.")
		return
	}

	ctx := r.Context()

	// 1. Persist an email suppression so future sends skip this user (idempotent).
	if h.suppressRepo != nil {
		if err := h.suppressRepo.Add(ctx, &model.Suppression{
			TenantID: claims.TenantID,
			UserID:   claims.UserID,
			Channel:  model.ChannelEmail,
			Reason:   model.SuppressionReasonUnsubscribe,
		}); err != nil {
			h.logger.Error().Err(err).Msg("failed to add email suppression on unsubscribe")
			writeUnsubscribeResult(w, http.StatusInternalServerError, "We could not process your request. Please try again later.")
			return
		}
	}

	// 2. Turn the user's email channel preference off (best-effort — the
	// suppression above is the authoritative block).
	if h.prefSvc != nil {
		if err := h.prefSvc.DisableEmail(ctx, claims.UserID, claims.TenantID); err != nil {
			h.logger.Warn().Err(err).Msg("failed to disable email preference after unsubscribe")
		}
	}

	h.logger.Info().
		Str("tenant_id", claims.TenantID).
		Str("user_id", claims.UserID).
		Str("type", claims.Type).
		Msg("user unsubscribed from email notifications")
	writeUnsubscribeResult(w, http.StatusOK, "You have been unsubscribed from these email notifications.")
}

// writeUnsubscribeResult renders a minimal confirmation page. The message is
// HTML-escaped defensively even though all call sites pass static strings.
func writeUnsubscribeResult(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
		`<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
		`<title>Unsubscribe</title></head>` +
		`<body style="margin:0;font-family:Arial,sans-serif;background:#FDFFF6;color:#06352F;">` +
		`<div style="max-width:520px;margin:60px auto;padding:32px;background:#FDFFF6;border:1px solid #D1D8D5;border-radius:8px;text-align:center;">` +
		`<h2 style="color:#06352F;margin-top:0;">Clario 360</h2>` +
		`<p style="color:#6C7874;font-size:15px;">` + template.HTMLEscapeString(message) + `</p>` +
		`</div></body></html>`))
}
