package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

var signatureSortColumns = map[string]string{
	"title":      "e.title",
	"status":     "e.status",
	"provider":   "e.provider",
	"due_at":     "e.due_at",
	"expires_at": "e.expires_at",
	"updated_at": "e.updated_at",
	"created_at": "e.created_at",
}

type SignatureHandler struct {
	baseHandler
	service *service.SignatureService
}

func NewSignatureHandler(service *service.SignatureService, logger zerolog.Logger) *SignatureHandler {
	return &SignatureHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

func (h *SignatureHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateSignatureEnvelopeRequest
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

func (h *SignatureHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseSignatureListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, total, err := h.service.List(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *SignatureHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.Get(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SignatureHandler) GetUserProfile(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	item, err := h.service.GetUserProfile(r.Context(), tenantID, userID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SignatureHandler) UpsertUserProfile(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.UpsertSignatureUserProfileRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpsertUserProfile(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SignatureHandler) DeleteUserProfile(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	if err := h.service.DeleteUserProfile(r.Context(), tenantID, userID); err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]string{"message": "signature profile deleted"})
}

func (h *SignatureHandler) UpsertPlacements(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpsertSignaturePlacementsRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpsertPlacements(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SignatureHandler) Send(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.SendSignatureEnvelopeRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Send(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// RecipientRendering handles GET /signatures/{id}/recipients/{recipientId}/rendering,
// returning the correct-language signing content for a recipient (WTQ-SIG-01).
func (h *SignatureHandler) RecipientRendering(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	recipientID, err := suiteapi.UUIDParam(r, "recipientId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	rendered, err := h.service.RenderRecipientText(r.Context(), tenantID, id, recipientID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, rendered)
}

func (h *SignatureHandler) RecipientAction(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	recipientID, err := suiteapi.UUIDParam(r, "recipientId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.SignatureRecipientActionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	ipAddress := requestIP(r)
	userAgent := optionalTrimmed(r.UserAgent())
	item, err := h.service.RecipientAction(r.Context(), tenantID, userID, id, recipientID, req, ipAddress, userAgent)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SignatureHandler) SelfRecipientAction(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	recipientID, err := suiteapi.UUIDParam(r, "recipientId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.SignatureRecipientActionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	userEmail := ""
	if user := auth.UserFromContext(r.Context()); user != nil {
		userEmail = user.Email
	}
	ipAddress := requestIP(r)
	userAgent := optionalTrimmed(r.UserAgent())
	item, err := h.service.SelfRecipientAction(r.Context(), tenantID, userID, userEmail, id, recipientID, req, ipAddress, userAgent)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SignatureHandler) ProviderEvent(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.SignatureProviderEventRequest
	rawPayload, err := decodeSignatureProviderEventRequest(r, &req)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	req.RawPayload = rawPayload
	applySignatureWebhookHeaders(r, &req)
	ipAddress := requestIP(r)
	userAgent := optionalTrimmed(r.UserAgent())
	item, err := h.service.ProviderEvent(r.Context(), tenantID, userID, id, req, ipAddress, userAgent)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SignatureHandler) RecordCustody(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RecordSignatureCustodyRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	ipAddress := requestIP(r)
	userAgent := optionalTrimmed(r.UserAgent())
	item, err := h.service.RecordCustody(r.Context(), tenantID, userID, id, req, ipAddress, userAgent)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SignatureHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CancelSignatureEnvelopeRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Cancel(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func parseSignatureListFilters(r *http.Request) (model.SignatureEnvelopeListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, signatureSortColumns, "updated_at", "desc")
	contractID, err := parseOptionalUUID(r.URL.Query().Get("contract_id"))
	if err != nil {
		return model.SignatureEnvelopeListFilters{}, fmt.Errorf("invalid contract_id")
	}
	documentID, err := parseOptionalUUID(r.URL.Query().Get("document_id"))
	if err != nil {
		return model.SignatureEnvelopeListFilters{}, fmt.Errorf("invalid document_id")
	}
	filters := model.SignatureEnvelopeListFilters{
		Page:          page,
		PerPage:       perPage,
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		ContractID:    contractID,
		DocumentID:    documentID,
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		value := model.SignatureEnvelopeStatus(status)
		filters.Status = &value
	}
	if provider := strings.TrimSpace(r.URL.Query().Get("provider")); provider != "" {
		value := model.SignatureProvider(provider)
		filters.Provider = &value
	}
	if method := strings.TrimSpace(r.URL.Query().Get("method")); method != "" {
		value := model.SignatureMethod(method)
		filters.Method = &value
	}
	return filters, nil
}

func decodeSignatureProviderEventRequest(r *http.Request, dst *dto.SignatureProviderEventRequest) ([]byte, error) {
	defer r.Body.Close()
	limited := io.LimitReader(r.Body, 1<<20+1)
	rawPayload, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(rawPayload) > 1<<20 {
		return nil, errors.New("request body too large")
	}
	decoder := json.NewDecoder(bytes.NewReader(rawPayload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return nil, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, errors.New("request body must contain a single JSON object")
	}
	return rawPayload, nil
}

func applySignatureWebhookHeaders(r *http.Request, req *dto.SignatureProviderEventRequest) {
	if req.WebhookSignature == nil {
		req.WebhookSignature = firstHeaderValue(r, "X-Clario-Signature", "X-Clario360-Signature", "X-Webhook-Signature", "X-Signature", "X-Hub-Signature-256", "X-Hub-Signature")
	}
	if req.WebhookTimestamp == nil {
		req.WebhookTimestamp = firstHeaderValue(r, "X-Clario-Timestamp", "X-Webhook-Timestamp", "X-Signature-Timestamp", "X-Timestamp")
	}
	if req.WebhookAlgorithm == nil {
		req.WebhookAlgorithm = firstHeaderValue(r, "X-Webhook-Signature-Algorithm", "X-Signature-Algorithm")
	}
	if req.WebhookSignatureBase == nil {
		req.WebhookSignatureBase = firstHeaderValue(r, "X-Webhook-Signature-Base", "X-Signature-Base")
	}
}

func firstHeaderValue(r *http.Request, keys ...string) *string {
	for _, key := range keys {
		if value := optionalTrimmed(r.Header.Get(key)); value != nil {
			return value
		}
	}
	return nil
}

func requestIP(r *http.Request) *string {
	for _, header := range []string{"X-Forwarded-For", "X-Real-IP"} {
		value := strings.TrimSpace(r.Header.Get(header))
		if value != "" {
			parts := strings.Split(value, ",")
			return optionalTrimmed(parts[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return optionalTrimmed(host)
	}
	return optionalTrimmed(r.RemoteAddr)
}

func optionalTrimmed(raw string) *string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	return &raw
}
