package trigger

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
)

// maxWebhookBody bounds the inbound webhook payload to 1 MiB, matching the
// integration webhook handler, so a hostile or runaway producer cannot exhaust
// memory.
const maxWebhookBody = 1 << 20

// WebhookResolver resolves an opaque path token to the enabled webhook-trigger
// automation it belongs to. The service (a later WP) implements it over the
// repository (a unique index on the webhook token); tests use a fake. Returning
// model.ErrNotFound for an unknown/disabled token lets the source answer 404
// without leaking whether a token ever existed.
type WebhookResolver interface {
	// ResolveWebhook returns the automation registered for token, or
	// model.ErrNotFound if no enabled webhook automation owns it.
	ResolveWebhook(ctx context.Context, token string) (*model.Automation, error)
}

// WebhookSource is the inbound-HTTP trigger source (model.TriggerTypeWebhook,
// §4.3 row "webhook"). The handler routes POST /api/v1/automation/webhooks/{token}
// (no JWT — token-authenticated) to Handle, which resolves the token to an
// automation, parses the request body, and fires a FiredTrigger. It mirrors
// internal/integration/handler/webhook_handler.go's body handling.
type WebhookSource struct {
	resolver   WebhookResolver
	dispatcher *Dispatcher
	logger     zerolog.Logger
}

// NewWebhookSource constructs a WebhookSource.
func NewWebhookSource(resolver WebhookResolver, dispatcher *Dispatcher, logger zerolog.Logger) (*WebhookSource, error) {
	if resolver == nil {
		return nil, fmt.Errorf("webhook source: resolver is required")
	}
	if dispatcher == nil {
		return nil, fmt.Errorf("webhook source: dispatcher is required")
	}
	return &WebhookSource{
		resolver:   resolver,
		dispatcher: dispatcher,
		logger:     logger.With().Str("component", "automation_webhook_source").Logger(),
	}, nil
}

// Type identifies this source.
func (s *WebhookSource) Type() string { return model.TriggerTypeWebhook }

// Handle is the net/http handler for an inbound webhook. It is self-contained
// (parses token from the path value, reads+limits the body, resolves the
// automation, fires) so it can be mounted directly with chi's r.Post. It writes
// a JSON response and the appropriate status: 202 on accept, 404 for an unknown
// token, 400 for a malformed body, 500 for a transient dispatch failure.
func (s *WebhookSource) Handle(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if token == "" {
		// chi populates path values via *r; fall back to the chi URL param when
		// PathValue is unset (older mux wiring). The handler layer passes the
		// token explicitly via HandleToken in that case.
		writeWebhookJSON(w, http.StatusBadRequest, map[string]any{"error": "missing webhook token"})
		return
	}
	s.HandleToken(w, r, token)
}

// HandleToken is Handle with the token supplied explicitly (the chi route reads
// chi.URLParam and calls this), keeping token extraction in the handler layer.
func (s *WebhookSource) HandleToken(w http.ResponseWriter, r *http.Request, token string) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxWebhookBody))
	if err != nil {
		writeWebhookJSON(w, http.StatusBadRequest, map[string]any{"error": "failed to read webhook payload"})
		return
	}

	eventID, ft, status, err := s.buildFiredTrigger(r.Context(), token, body)
	if err != nil {
		writeWebhookJSON(w, status, map[string]any{"error": err.Error()})
		return
	}

	if err := s.dispatcher.Dispatch(r.Context(), ft); err != nil {
		s.logger.Error().Err(err).Str("token_hash", hashToken(token)).Msg("webhook dispatch failed")
		writeWebhookJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to accept webhook"})
		return
	}

	writeWebhookJSON(w, http.StatusAccepted, map[string]any{
		"data": map[string]any{
			"accepted": true,
			"event_id": eventID,
		},
	})
}

// buildFiredTrigger resolves the token, parses the body, and assembles the
// FiredTrigger plus the HTTP status to use on error. It is the testable core of
// the handler: tests exercise body parse + token resolution without an
// http.ResponseWriter. The EventID is derived from the token and a content hash
// of the body so an at-least-once webhook retry (same token + same body) is
// suppressed by the idempotency guard, while a genuinely new payload is a new
// run.
func (s *WebhookSource) buildFiredTrigger(ctx context.Context, token string, body []byte) (string, FiredTrigger, int, error) {
	automation, err := s.resolver.ResolveWebhook(ctx, token)
	if err != nil {
		if isNotFound(err) {
			return "", FiredTrigger{}, http.StatusNotFound, fmt.Errorf("unknown webhook token")
		}
		return "", FiredTrigger{}, http.StatusInternalServerError, fmt.Errorf("resolving webhook token: %w", err)
	}
	if automation.Trigger.Type != model.TriggerTypeWebhook {
		// Defensive: the resolver promised a webhook automation. A mismatch is a
		// server bug, not a client error.
		return "", FiredTrigger{}, http.StatusInternalServerError, fmt.Errorf("resolved automation is not a webhook trigger")
	}

	parsed := parseWebhookBody(body)
	eventID := fmt.Sprintf("webhook:%s:%s", automation.ID, hashBody(body))
	ft := FiredTrigger{
		AutomationID: automation.ID,
		TenantID:     automation.TenantID,
		EventID:      eventID,
		TriggerType:  model.TriggerTypeWebhook,
		Payload: map[string]any{
			"trigger": map[string]any{
				"type": model.TriggerTypeWebhook,
				"data": parsed,
			},
		},
	}
	return eventID, ft, http.StatusAccepted, nil
}

// parseWebhookBody decodes the body as JSON when possible, falling back to the
// raw string under a "raw" key so a non-JSON payload is still recorded for
// replay rather than dropped. An empty body yields an empty object.
func parseWebhookBody(body []byte) map[string]any {
	if len(body) == 0 {
		return map[string]any{}
	}
	var obj map[string]any
	if err := json.Unmarshal(body, &obj); err == nil {
		return obj
	}
	// Not a JSON object: try a JSON value (array, string, number) under "value".
	var val any
	if err := json.Unmarshal(body, &val); err == nil {
		return map[string]any{"value": val}
	}
	// Not JSON at all: keep the raw text.
	return map[string]any{"raw": string(body)}
}

// hashBody returns a short content hash of the body for the dedupe-stable
// EventID. Two identical retried payloads hash equal (suppressed); a different
// payload hashes differently (a new run).
func hashBody(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:8])
}

// hashToken returns a short hash of the token for safe logging (never log the
// raw token, §5 secrets handling).
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:6])
}

// writeWebhookJSON writes a JSON body with the given status, never panicking on
// an encode failure (the response is best-effort at that point).
func writeWebhookJSON(w http.ResponseWriter, status int, body map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
