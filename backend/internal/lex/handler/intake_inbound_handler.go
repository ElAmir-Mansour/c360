package handler

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/lex/service/integration"
	"github.com/clario360/platform/internal/suiteapi"
)

// SimulateInbound is the JWT-gated Simulate-Inbound admin action (CAP-002/003).
// It sits behind the mailbox-admin tier (org-RBAC edit on the mailbox's entity),
// so the caller is authenticated + authorized before this runs. It synthesizes an
// inbound email against the addressed mailbox and drives the FULL classify→route→
// legal_request pipeline with ZERO external dependencies — the demonstrable path
// for the inbound-email bridge without a live mail provider.
func (h *IntakeHandler) SimulateInbound(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.IntakeSimulateRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.SimulateInbound(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// IngestInboundParsed is the PUBLIC provider inbound-parse receiver. Like the
// HMAC webhook it is registered OUTSIDE the JWT chain and rate-limited per-IP, but
// its authentication is the PROVIDER'S OWN signature/shared-secret (verified in
// integration.VerifyAndNormalizeInbound), NOT the per-mailbox HMAC. That makes
// fail-closed behaviour load-bearing:
//   - unknown {provider}            -> 404 (no such receiver)
//   - provider with no secret set   -> 404 (receiver disabled; never allow-all)
//   - signature/secret mismatch     -> 401 (uniform, no existence oracle)
//   - body too large / unparseable  -> 400
//
// On success the neutral message is handed to the service's TRUSTED ingress
// (IngestInboundParsed), which resolves the mailbox by recipient and runs the
// shared pipeline; ingestion is idempotent on the provider Message-ID.
func (h *IntakeHandler) IngestInboundParsed(w http.ResponseWriter, r *http.Request) {
	provider, ok := integration.ParseInboundProvider(chi.URLParam(r, "provider"))
	if !ok {
		suiteapi.WriteError(w, r, http.StatusNotFound, "NOT_FOUND", "unknown inbound provider", nil)
		return
	}
	secret := ""
	if h.inboundProviderSecrets != nil {
		secret = strings.TrimSpace(h.inboundProviderSecrets[string(provider)])
	}
	if secret == "" {
		// Receiver disabled for this provider (no configured secret). 404 so an
		// attacker cannot distinguish "disabled" from "unknown", and never an
		// unauthenticated ingest.
		suiteapi.WriteError(w, r, http.StatusNotFound, "NOT_FOUND", "inbound provider not configured", nil)
		return
	}

	rawBody, err := readLimitedBody(r, intakeWebhookMaxBody)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}

	normalized, err := integration.VerifyAndNormalizeInbound(provider, secret, r.Header, rawBody)
	if err != nil {
		switch {
		case errors.Is(err, integration.ErrInboundSignatureInvalid):
			suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "inbound authentication failed", nil)
		case errors.Is(err, integration.ErrInboundProviderUnsupported):
			suiteapi.WriteError(w, r, http.StatusNotFound, "NOT_FOUND", "unknown inbound provider", nil)
		default:
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "unable to parse inbound message", nil)
		}
		return
	}

	req := inboundToWebhookRequest(normalized)
	item, err := h.service.IngestInboundParsed(r.Context(), req, "provider:"+string(provider))
	if err != nil {
		if errors.Is(err, service.ErrIntakeMailboxNotFound) {
			// Provider is authenticated, so this is a genuine "no mailbox owns this
			// recipient" — a 404 is informative, not an enumeration oracle.
			suiteapi.WriteError(w, r, http.StatusNotFound, "NOT_FOUND", "no mailbox for recipient", nil)
			return
		}
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, item)
}

// inboundToWebhookRequest maps the provider-neutral normalized message onto the
// intake pipeline's webhook DTO (the single shape ingestNormalized consumes).
func inboundToWebhookRequest(m integration.NormalizedInboundMessage) dto.IntakeEmailWebhookRequest {
	attachments := make([]dto.IntakeEmailAttachment, 0, len(m.Attachments))
	for _, a := range m.Attachments {
		attachments = append(attachments, dto.IntakeEmailAttachment{
			Filename:    a.Filename,
			ContentType: a.ContentType,
			ContentB64:  a.ContentB64,
		})
	}
	return dto.IntakeEmailWebhookRequest{
		MessageID:   m.MessageID,
		From:        m.From,
		To:          m.To,
		Subject:     m.Subject,
		Body:        m.Body,
		Attachments: attachments,
	}
}

// readLimitedBody reads at most max bytes from the request body, rejecting an
// over-cap body. Mirrors decodeIntakeEmailWebhookRequest's guard for the
// provider receiver (which parses the raw bytes provider-specifically).
func readLimitedBody(r *http.Request, max int64) ([]byte, error) {
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > max {
		return nil, errors.New("request body too large")
	}
	return raw, nil
}
