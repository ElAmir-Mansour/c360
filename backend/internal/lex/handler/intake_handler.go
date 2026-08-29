package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// intakeWebhookMaxBody caps the email webhook body to bound HMAC/parse cost.
const intakeWebhookMaxBody = 8 << 20 // 8 MiB

type IntakeHandler struct {
	baseHandler
	service *service.IntakeService
	// inboundProviderSecrets maps a provider name (mailgun|sendgrid|postmark|ses)
	// to its configured inbound signing/shared secret. A provider with no entry
	// (or an empty value) is DISABLED: the receiver route 404s for it before any
	// verification, so an unconfigured provider is never an unauthenticated ingest.
	inboundProviderSecrets map[string]string
}

func NewIntakeHandler(service *service.IntakeService, logger zerolog.Logger) *IntakeHandler {
	return &IntakeHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

// WithInboundProviderSecrets wires the provider inbound-parse receiver's per-
// provider secrets (from LEX_INBOUND_EMAIL_<PROVIDER>_SECRET). Chainable at
// construction. A nil/empty map leaves every provider receiver disabled (404).
func (h *IntakeHandler) WithInboundProviderSecrets(secrets map[string]string) *IntakeHandler {
	h.inboundProviderSecrets = secrets
	return h
}

// ---- mailbox administration (JWT-gated) ----

func (h *IntakeHandler) CreateMailbox(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateIntakeMailboxRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.CreateMailbox(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *IntakeHandler) ListMailboxes(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters := model.IntakeMailboxListFilters{
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		SortColumn:    strings.TrimSpace(r.URL.Query().Get("sort")),
		SortDirection: strings.TrimSpace(r.URL.Query().Get("dir")),
	}
	filters.Page, filters.PerPage = suiteapi.ParsePagination(r)
	if active := strings.TrimSpace(r.URL.Query().Get("active")); active != "" {
		if parsed, err := strconv.ParseBool(active); err == nil {
			filters.Active = &parsed
		}
	}
	items, total, err := h.service.ListMailboxes(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *IntakeHandler) GetMailbox(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetMailbox(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *IntakeHandler) UpdateMailbox(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateIntakeMailboxRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpdateMailbox(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *IntakeHandler) DeleteMailbox(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.DeleteMailbox(r.Context(), tenantID, userID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- intake messages (read, JWT-gated) ----

func (h *IntakeHandler) ListMessages(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters := model.IntakeMessageListFilters{
		Search: strings.TrimSpace(r.URL.Query().Get("search")),
	}
	filters.Page, filters.PerPage = suiteapi.ParsePagination(r)
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		value := model.IntakeMessageStatus(status)
		filters.Status = &value
	}
	if mailboxID, err := parseOptionalUUID(r.URL.Query().Get("mailbox_id")); err == nil {
		filters.MailboxID = mailboxID
	}
	items, total, err := h.service.ListMessages(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *IntakeHandler) GetMessage(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetMessage(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// ---- direct platform submission (JWT-gated) ----

func (h *IntakeHandler) Submit(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.IntakeSubmitRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	requesterName := ""
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		requesterName = strings.TrimSpace(claims.Email)
	}
	item, err := h.service.Submit(r.Context(), tenantID, userID, requesterName, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// IngestEmail is the PUBLIC email webhook (CAP-002). It is registered OUTSIDE
// the JWT subrouter: it carries NO bearer token and NO tenant context. The
// only authentication is the HMAC signature header verified against the
// addressed mailbox's ingest secret. The handler reads the EXACT raw body bytes
// the signature was computed over before decoding.
func (h *IntakeHandler) IngestEmail(w http.ResponseWriter, r *http.Request) {
	rawBody, req, err := decodeIntakeEmailWebhookRequest(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	signature := firstHeaderValueString(r, "X-Clario360-Signature", "X-Clario-Signature", "X-Webhook-Signature", "X-Signature", "X-Hub-Signature-256")
	if timestamp := firstHeaderValueString(r, "X-Clario360-Timestamp", "X-Clario-Timestamp", "X-Webhook-Timestamp", "X-Signature-Timestamp", "X-Timestamp"); timestamp != "" {
		req.WebhookTimestamp = timestamp
	}
	item, err := h.service.IngestEmail(r.Context(), signature, rawBody, req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrIntakeSignatureInvalid), errors.Is(err, service.ErrIntakeMailboxNotFound):
			// De-oracle (WS5): an unverified caller must NOT be able to distinguish
			// "no such mailbox" (would-be 404) from "bad signature" (would-be 401).
			// Either case is an authentication failure from the caller's view, so we
			// emit ONE uniform 401 with a generic message and no entity-existence
			// signal. The HMAC is verified inside the service BEFORE any
			// mailbox/tenant detail is returned, so a valid signature is required to
			// learn anything. Validation failures (missing message_id/to) remain a
			// 400 below — those leak no existence and are pre-signature shape checks.
			suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "webhook authentication failed", nil)
		default:
			h.writeError(w, r, err)
		}
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, item)
}

func decodeIntakeEmailWebhookRequest(r *http.Request) ([]byte, dto.IntakeEmailWebhookRequest, error) {
	defer r.Body.Close()
	rawBody, err := io.ReadAll(io.LimitReader(r.Body, intakeWebhookMaxBody+1))
	if err != nil {
		return nil, dto.IntakeEmailWebhookRequest{}, err
	}
	if len(rawBody) > intakeWebhookMaxBody {
		return nil, dto.IntakeEmailWebhookRequest{}, errors.New("request body too large")
	}
	var req dto.IntakeEmailWebhookRequest
	decoder := json.NewDecoder(bytes.NewReader(rawBody))
	if err := decoder.Decode(&req); err != nil {
		return nil, dto.IntakeEmailWebhookRequest{}, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, dto.IntakeEmailWebhookRequest{}, errors.New("request body must contain a single JSON object")
	}
	return rawBody, req, nil
}

func firstHeaderValueString(r *http.Request, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(r.Header.Get(key)); value != "" {
			return value
		}
	}
	return ""
}
