package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

type DocumentEditorHandler struct {
	baseHandler
	service *service.DocumentEditorService
}

func NewDocumentEditorHandler(service *service.DocumentEditorService, logger zerolog.Logger) *DocumentEditorHandler {
	return &DocumentEditorHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

func (h *DocumentEditorHandler) OpenSession(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.OpenDocumentEditorSessionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	req.BaseURL = requestBaseURL(r)
	req.RoutePrefix = lexRoutePrefix(r)
	actor := editorActorFromRequest(r, userID, req.UserDisplayName)
	result, err := h.service.OpenSession(r.Context(), tenantID, documentID, actor, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, result)
}

func (h *DocumentEditorHandler) Callback(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	payload, err := decodeJSONMap(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	if sessionID := strings.TrimSpace(r.URL.Query().Get("session_id")); sessionID != "" {
		if _, exists := payload["session_id"]; !exists {
			payload["session_id"] = sessionID
		}
	}
	token := strings.TrimSpace(r.URL.Query().Get("callback_token"))
	if token == "" {
		token = strings.TrimSpace(r.Header.Get("X-Lex-Editor-Callback-Token"))
	}
	if token != "" {
		if _, exists := payload["callback_token"]; !exists {
			payload["callback_token"] = token
		}
	}
	result, err := h.service.HandleCallback(r.Context(), tenantID, documentID, &userID, payload)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	response := map[string]any{
		"error":                      0,
		"version_snapshot_requested": result.VersionSnapshotRequested,
	}
	if result.Session != nil {
		response["session_id"] = result.Session.ID.String()
	}
	suiteapi.WriteJSON(w, http.StatusOK, response)
}

func (h *DocumentEditorHandler) AcquireLock(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.AcquireDocumentEditorLockRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	lock, err := h.service.AcquireLock(r.Context(), tenantID, documentID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, lock)
}

func (h *DocumentEditorHandler) ReleaseLock(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.ReleaseDocumentEditorLockRequest
	if err := decodeOptionalJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	lock, err := h.service.ReleaseLock(r.Context(), tenantID, documentID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, lock)
}

func (h *DocumentEditorHandler) Snapshot(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RequestDocumentEditorSnapshotRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	snapshot, err := h.service.RequestSnapshot(r.Context(), tenantID, documentID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, snapshot)
}

func (h *DocumentEditorHandler) Audit(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	items, total, err := h.service.ListAudit(r.Context(), tenantID, documentID, page, perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *DocumentEditorHandler) Preflight(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.SubmitDocumentEditorPreflightRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	result, err := h.service.SubmitPreflight(r.Context(), tenantID, documentID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

func (h *DocumentEditorHandler) NegotiationRoom(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.NegotiationRoomSummary(r.Context(), tenantID, documentID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, negotiationRoomResponse(result))
}

func (h *DocumentEditorHandler) UpsertNegotiationRoom(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.recordWorkspaceAction(w, r, "editor.negotiation_room_updated", nil); !ok {
		return
	}
	h.NegotiationRoom(w, r)
}

func (h *DocumentEditorHandler) AddNegotiationMessage(w http.ResponseWriter, r *http.Request) {
	result, payload, documentID, userID, ok := h.recordWorkspaceActionWithPayload(w, r, "editor.negotiation_message_added", nil)
	if !ok {
		return
	}
	message := map[string]any{
		"id":          result["request_id"],
		"document_id": documentID,
		"author_id":   userID,
		"author_name": "",
		"body":        stringFromPayload(payload, "body", "message", "text"),
		"clause_id":   stringFromPayload(payload, "clause_id", "clauseId"),
		"section_id":  stringFromPayload(payload, "section_id", "sectionId", "section_reference", "sectionReference"),
		"status":      firstNonEmptyString(stringFromPayload(payload, "status"), "open"),
		"created_at":  result["created_at"],
		"metadata":    metadataFromPayload(payload),
	}
	suiteapi.WriteData(w, http.StatusAccepted, message)
}

func (h *DocumentEditorHandler) PlaybookEnforcement(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.PlaybookEnforcementSummary(r.Context(), tenantID, documentID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, playbookEnforcementResponse(result))
}

func (h *DocumentEditorHandler) RunPlaybookEnforcement(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.recordWorkspaceAction(w, r, "editor.playbook_enforcement_requested", nil); !ok {
		return
	}
	h.PlaybookEnforcement(w, r)
}

func (h *DocumentEditorHandler) Navigator(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.NavigatorSummary(r.Context(), tenantID, documentID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, termsCrossReferencesResponse(result))
}

func (h *DocumentEditorHandler) AnalyzeTermsCrossReferences(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.recordWorkspaceAction(w, r, "editor.terms_cross_references_requested", nil); !ok {
		return
	}
	h.Navigator(w, r)
}

func (h *DocumentEditorHandler) SectionAssignments(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.SectionAssignmentsSummary(r.Context(), tenantID, documentID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

func (h *DocumentEditorHandler) SectionAssignmentList(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.SectionAssignmentsSummary(r.Context(), tenantID, documentID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, sectionAssignmentsResponse(result))
}

func (h *DocumentEditorHandler) UpsertSectionAssignments(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.recordWorkspaceAction(w, r, "editor.section_assignments_updated", nil); !ok {
		return
	}
	h.SectionAssignmentList(w, r)
}

func (h *DocumentEditorHandler) GuestReviewLink(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	payload, err := decodeOptionalJSONMap(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	req := guestReviewLinkRequestFromPayload(payload)
	result, err := h.service.RequestGuestReviewLink(r.Context(), tenantID, documentID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, guestReviewLinkResponse(result))
}

func (h *DocumentEditorHandler) GuestReviewLinks(w http.ResponseWriter, r *http.Request) {
	suiteapi.WriteData(w, http.StatusOK, []map[string]any{})
}

func (h *DocumentEditorHandler) RevokeGuestReviewLink(w http.ResponseWriter, r *http.Request) {
	linkID := strings.TrimSpace(chi.URLParam(r, "linkId"))
	result, payload, documentID, _, ok := h.recordWorkspaceActionWithPayload(w, r, "editor.guest_review_link_revoked", func(detail map[string]any) {
		detail["link_id"] = linkID
	})
	if !ok {
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{
		"id":          firstNonEmptyString(linkID, stringFromPayload(payload, "id"), stringFromPayload(result, "request_id")),
		"document_id": documentID,
		"status":      "revoked",
		"revoked_at":  result["created_at"],
		"metadata":    metadataFromPayload(payload),
	})
}

func (h *DocumentEditorHandler) LegalIssues(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.LegalIssuesSummary(r.Context(), tenantID, documentID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

func (h *DocumentEditorHandler) LegalIssueList(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.LegalIssuesSummary(r.Context(), tenantID, documentID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, legalIssuesResponse(result))
}

func (h *DocumentEditorHandler) CreateLegalIssue(w http.ResponseWriter, r *http.Request) {
	result, payload, documentID, _, ok := h.recordWorkspaceActionWithPayload(w, r, "editor.legal_issue_created", nil)
	if !ok {
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, legalIssueResponse(documentID, result, payload, "open"))
}

func (h *DocumentEditorHandler) UpdateLegalIssue(w http.ResponseWriter, r *http.Request) {
	issueID := strings.TrimSpace(chi.URLParam(r, "issueId"))
	result, payload, documentID, _, ok := h.recordWorkspaceActionWithPayload(w, r, "editor.legal_issue_updated", func(detail map[string]any) {
		detail["issue_id"] = issueID
	})
	if !ok {
		return
	}
	payload["id"] = issueID
	suiteapi.WriteData(w, http.StatusOK, legalIssueResponse(documentID, result, payload, firstNonEmptyString(stringFromPayload(payload, "status"), "open")))
}

func (h *DocumentEditorHandler) ResolveLegalIssue(w http.ResponseWriter, r *http.Request) {
	issueID := strings.TrimSpace(chi.URLParam(r, "issueId"))
	result, payload, documentID, _, ok := h.recordWorkspaceActionWithPayload(w, r, "editor.legal_issue_resolved", func(detail map[string]any) {
		detail["issue_id"] = issueID
	})
	if !ok {
		return
	}
	payload["id"] = issueID
	suiteapi.WriteData(w, http.StatusOK, legalIssueResponse(documentID, result, payload, "resolved"))
}

func (h *DocumentEditorHandler) SignatureReadiness(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.SignatureReadinessSummary(r.Context(), tenantID, documentID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, signatureReadinessResponse(result))
}

func (h *DocumentEditorHandler) RunSignatureReadiness(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.recordWorkspaceAction(w, r, "editor.signature_readiness_requested", nil); !ok {
		return
	}
	h.SignatureReadiness(w, r)
}

func (h *DocumentEditorHandler) ClauseAIAction(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RequestDocumentEditorClauseAIActionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	result, err := h.service.RequestClauseAIAction(r.Context(), tenantID, documentID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, clauseAIActionResponse(result))
}

func (h *DocumentEditorHandler) Health(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.HealthScore(r.Context(), tenantID, documentID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, healthScoreResponse(result))
}

func (h *DocumentEditorHandler) RefreshHealth(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.recordWorkspaceAction(w, r, "editor.health_score_requested", nil); !ok {
		return
	}
	h.Health(w, r)
}

func (h *DocumentEditorHandler) PrivilegedControls(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.PrivilegedControlsSummary(r.Context(), tenantID, documentID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, privilegedControlsResponse(result))
}

func (h *DocumentEditorHandler) PrivilegedControlRequest(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RequestDocumentEditorPrivilegedControlRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	result, err := h.service.RequestPrivilegedControl(r.Context(), tenantID, documentID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, result)
}

func (h *DocumentEditorHandler) UpdatePrivilegedControls(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.recordWorkspaceAction(w, r, "editor.privileged_controls_updated", nil); !ok {
		return
	}
	h.PrivilegedControls(w, r)
}

func (h *DocumentEditorHandler) ProviderEvents(w http.ResponseWriter, r *http.Request) {
	h.writeEditorCapabilitySummary(w, r, "provider_events")
}

func (h *DocumentEditorHandler) RecordProviderEvent(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.provider_event.received", "provider_event", http.StatusAccepted, [][]string{{"event_type", "eventType", "type", "status"}}, func(detail map[string]any) {
		if provider := providerFromRequest(r, detail); provider != "" {
			detail["provider"] = provider
		}
	})
}

func (h *DocumentEditorHandler) GuestPortal(w http.ResponseWriter, r *http.Request) {
	linkID := strings.TrimSpace(chi.URLParam(r, "linkId"))
	h.writeEditorCapabilitySummaryWith(w, r, "guest_portal", func(result map[string]any) {
		if linkID != "" {
			result["link_id"] = linkID
		}
	})
}

func (h *DocumentEditorHandler) ValidateGuestPortal(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.guest_review.validated", "guest_portal", http.StatusOK, [][]string{{"token", "guest_token", "guestToken", "link_token", "linkToken"}}, func(detail map[string]any) {
		token := stringFromPayload(detail, "token", "guest_token", "guestToken", "link_token", "linkToken")
		detail["token_present"] = token != ""
		detail["token_fingerprint"] = tokenFingerprint(token)
		delete(detail, "token")
		delete(detail, "guest_token")
		delete(detail, "guestToken")
		delete(detail, "link_token")
		delete(detail, "linkToken")
		if status := strings.ToLower(stringFromPayload(detail, "status")); status == "revoked" {
			detail["valid"] = false
			detail["reason"] = "revoked"
		} else if expiresAt := timePtrFromPayload(detail, "expires_at", "expiresAt"); expiresAt != nil && !expiresAt.After(time.Now().UTC()) {
			detail["valid"] = false
			detail["reason"] = "expired"
		} else {
			detail["valid"] = true
			detail["reason"] = "accepted"
		}
		if detail["access_mode"] == nil && detail["accessMode"] == nil {
			detail["access_mode"] = string(model.DocumentEditorModeComment)
		}
	})
}

func (h *DocumentEditorHandler) GuestPortalToken(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(chi.URLParam(r, "token"))
	if token == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "guest portal token is required", nil)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, guestPortalTokenResponse(token, "ready", nil))
}

func (h *DocumentEditorHandler) GuestPortalTokenSession(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(chi.URLParam(r, "token"))
	if token == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "guest portal token is required", nil)
		return
	}
	payload, err := decodeOptionalJSONMap(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	response := guestPortalTokenResponse(token, "session_created", payload)
	response["session_id"] = uuid.New()
	response["mode"] = firstNonEmptyString(stringFromPayload(payload, "mode", "access_mode", "accessMode"), string(model.DocumentEditorModeComment))
	suiteapi.WriteData(w, http.StatusCreated, response)
}

func (h *DocumentEditorHandler) GuestPortalTokenComment(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(chi.URLParam(r, "token"))
	if token == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "guest portal token is required", nil)
		return
	}
	payload, err := decodeOptionalJSONMap(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	if !payloadHasAny(payload, "body", "message", "text") {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "missing required request field", map[string]any{"required_any_of": []string{"body", "message", "text"}})
		return
	}
	response := guestPortalTokenResponse(token, "comment_received", payload)
	response["comment_id"] = uuid.New()
	response["body"] = stringFromPayload(payload, "body", "message", "text")
	suiteapi.WriteData(w, http.StatusAccepted, response)
}

func (h *DocumentEditorHandler) AddGuestPortalComment(w http.ResponseWriter, r *http.Request) {
	linkID := strings.TrimSpace(chi.URLParam(r, "linkId"))
	h.writeValidatedWorkspaceAction(w, r, "editor.guest_comment.added", "guest_comment", http.StatusAccepted, [][]string{{"body", "message", "text"}}, func(detail map[string]any) {
		detail["link_id"] = linkID
	})
}

func (h *DocumentEditorHandler) EditorTasks(w http.ResponseWriter, r *http.Request) {
	h.writeEditorCapabilitySummary(w, r, "task_automation")
}

func (h *DocumentEditorHandler) CreateEditorTask(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.task.created", "task", http.StatusAccepted, [][]string{{"title", "issue_id", "issueId", "source_id", "sourceId"}}, nil)
}

func (h *DocumentEditorHandler) UpdateEditorTask(w http.ResponseWriter, r *http.Request) {
	taskID := strings.TrimSpace(chi.URLParam(r, "taskId"))
	h.writeValidatedWorkspaceAction(w, r, "editor.task.updated", "task", http.StatusOK, nil, func(detail map[string]any) {
		detail["task_id"] = taskID
	})
}

func (h *DocumentEditorHandler) ClauseAnchors(w http.ResponseWriter, r *http.Request) {
	h.writeEditorCapabilitySummary(w, r, "clause_anchors")
}

func (h *DocumentEditorHandler) UpsertClauseAnchors(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.clause_anchor.upserted", "clause_anchors", http.StatusOK, [][]string{{"anchors", "section_reference", "sectionReference", "clause_id", "clauseId"}}, nil)
}

func (h *DocumentEditorHandler) ExtractClauseAnchors(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.clause_anchor.extracted", "clause_anchors", http.StatusAccepted, nil, nil)
}

func (h *DocumentEditorHandler) RedlinePackages(w http.ResponseWriter, r *http.Request) {
	h.writeEditorCapabilitySummary(w, r, "redline_package")
}

func (h *DocumentEditorHandler) GenerateRedlinePackage(w http.ResponseWriter, r *http.Request) {
	h.writeRecordedWorkspaceAction(w, r, "editor.redline_package.requested", "redline_package", http.StatusAccepted, nil)
}

func (h *DocumentEditorHandler) ApprovalMatrix(w http.ResponseWriter, r *http.Request) {
	h.writeEditorCapabilitySummary(w, r, "approval_matrix")
}

func (h *DocumentEditorHandler) RequestApprovalMatrix(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.approval.requested", "approval_request", http.StatusAccepted, [][]string{{"trigger", "reason", "approval_key", "approvalKey"}}, nil)
}

func (h *DocumentEditorHandler) UpdateApprovalMatrix(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.approval_matrix.updated", "approval_matrix", http.StatusOK, nil, nil)
}

func (h *DocumentEditorHandler) CompareWorkspace(w http.ResponseWriter, r *http.Request) {
	h.writeEditorCapabilitySummary(w, r, "compare_workspace")
}

func (h *DocumentEditorHandler) CompareDocument(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.compare.requested", "comparison", http.StatusAccepted, [][]string{{"base_version", "baseVersion", "base_document_id", "baseDocumentId"}, {"target_version", "targetVersion", "target_document_id", "targetDocumentId", "compare_to", "compareTo"}}, nil)
}

func (h *DocumentEditorHandler) CollaborationInbox(w http.ResponseWriter, r *http.Request) {
	h.writeEditorCapabilitySummary(w, r, "collaboration_inbox")
}

func (h *DocumentEditorHandler) MarkCollaborationInboxItemRead(w http.ResponseWriter, r *http.Request) {
	itemID := strings.TrimSpace(chi.URLParam(r, "itemId"))
	h.writeValidatedWorkspaceAction(w, r, "editor.inbox.read", "inbox_item", http.StatusOK, nil, func(detail map[string]any) {
		detail["item_id"] = itemID
	})
}

func (h *DocumentEditorHandler) PlaybookRules(w http.ResponseWriter, r *http.Request) {
	h.writeEditorCapabilitySummary(w, r, "playbook_rules")
}

func (h *DocumentEditorHandler) CreatePlaybookRule(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.playbook_rule.created", "playbook_rule", http.StatusAccepted, [][]string{{"rules", "key", "title", "clause_type", "clauseType"}}, nil)
}

func (h *DocumentEditorHandler) UpsertPlaybookRules(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.playbook_rule.upserted", "playbook_rules", http.StatusOK, [][]string{{"rules", "key", "title", "clause_type", "clauseType"}}, nil)
}

func (h *DocumentEditorHandler) DefinedTermRepairs(w http.ResponseWriter, r *http.Request) {
	h.writeEditorCapabilitySummary(w, r, "defined_term_repairs")
}

func (h *DocumentEditorHandler) RepairDefinedTerm(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.defined_term_repair.requested", "term_repair", http.StatusAccepted, [][]string{{"actions", "term", "reference"}, {"actions", "action", "repair_action", "repairAction"}}, nil)
}

func (h *DocumentEditorHandler) Citations(w http.ResponseWriter, r *http.Request) {
	h.writeEditorCapabilitySummary(w, r, "citation_evidence")
}

func (h *DocumentEditorHandler) CreateCitation(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.citation.bound", "citation", http.StatusAccepted, [][]string{{"source_type", "sourceType"}, {"source_id", "sourceId", "source_url", "sourceUrl"}, {"section_id", "sectionId", "section_reference", "sectionReference", "anchor", "text_anchor", "textAnchor"}}, nil)
}

func (h *DocumentEditorHandler) AIChangeSafety(w http.ResponseWriter, r *http.Request) {
	h.writeEditorCapabilitySummary(w, r, "ai_change_safety")
}

func (h *DocumentEditorHandler) RequestAIChange(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.ai_change.requested", "ai_change", http.StatusAccepted, [][]string{{"proposed_text", "proposedText", "change", "prompt", "action_id", "actionId"}}, nil)
}

func (h *DocumentEditorHandler) UpdateAIChangeSafety(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.ai_change_safety.updated", "ai_change_safety", http.StatusOK, nil, nil)
}

func (h *DocumentEditorHandler) OfflineRecovery(w http.ResponseWriter, r *http.Request) {
	h.writeEditorCapabilitySummary(w, r, "offline_recovery")
}

func (h *DocumentEditorHandler) SaveOfflineRecovery(w http.ResponseWriter, r *http.Request) {
	h.writeValidatedWorkspaceAction(w, r, "editor.offline_recovery.saved", "recovery_point", http.StatusAccepted, [][]string{{"draft", "payload", "encrypted_buffer", "encryptedBuffer", "encrypted_payload", "encryptedPayload", "checksum"}}, nil)
}

func (h *DocumentEditorHandler) RestoreOfflineRecovery(w http.ResponseWriter, r *http.Request) {
	recoveryID := strings.TrimSpace(chi.URLParam(r, "recoveryId"))
	h.writeValidatedWorkspaceAction(w, r, "editor.offline_recovery.restored", "recovery_restore", http.StatusAccepted, nil, func(detail map[string]any) {
		detail["recovery_id"] = firstNonEmptyString(recoveryID, stringFromPayload(detail, "recovery_id", "recoveryId"))
	})
}

func (h *DocumentEditorHandler) DeleteOfflineRecovery(w http.ResponseWriter, r *http.Request) {
	recoveryID := strings.TrimSpace(chi.URLParam(r, "recoveryId"))
	h.writeValidatedWorkspaceAction(w, r, "editor.offline_recovery.deleted", "recovery_delete", http.StatusOK, nil, func(detail map[string]any) {
		detail["recovery_id"] = firstNonEmptyString(recoveryID, stringFromPayload(detail, "recovery_id", "recoveryId"))
	})
}

func (h *DocumentEditorHandler) Analytics(w http.ResponseWriter, r *http.Request) {
	h.writeEditorCapabilitySummary(w, r, "editor_analytics")
}

func (h *DocumentEditorHandler) recordWorkspaceAction(w http.ResponseWriter, r *http.Request, action string, enrich func(map[string]any)) (map[string]any, bool) {
	result, _, _, _, ok := h.recordWorkspaceActionWithPayload(w, r, action, enrich)
	return result, ok
}

func (h *DocumentEditorHandler) recordWorkspaceActionWithPayload(w http.ResponseWriter, r *http.Request, action string, enrich func(map[string]any)) (map[string]any, map[string]any, uuid.UUID, uuid.UUID, bool) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return nil, nil, uuid.Nil, uuid.Nil, false
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return nil, nil, uuid.Nil, uuid.Nil, false
	}
	payload, err := decodeOptionalJSONMap(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return nil, nil, uuid.Nil, uuid.Nil, false
	}
	if enrich != nil {
		enrich(payload)
	}
	result, err := h.service.RecordWorkspaceAction(r.Context(), tenantID, documentID, userID, action, payload)
	if err != nil {
		h.writeError(w, r, err)
		return nil, nil, uuid.Nil, uuid.Nil, false
	}
	return result, payload, documentID, userID, true
}

type editorRequestContext struct {
	tenantID   uuid.UUID
	userID     uuid.UUID
	documentID uuid.UUID
}

func (h *DocumentEditorHandler) editorDocumentContext(w http.ResponseWriter, r *http.Request) (editorRequestContext, bool) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return editorRequestContext{}, false
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return editorRequestContext{}, false
	}
	return editorRequestContext{tenantID: tenantID, userID: userID, documentID: documentID}, true
}

func (h *DocumentEditorHandler) writeRecordedWorkspaceAction(w http.ResponseWriter, r *http.Request, action, resource string, status int, enrich func(map[string]any)) {
	result, payload, documentID, userID, ok := h.recordWorkspaceActionWithPayload(w, r, action, enrich)
	if !ok {
		return
	}
	suiteapi.WriteData(w, status, workspaceActionResponse(resource, documentID, userID, action, result, payload))
}

func (h *DocumentEditorHandler) writeEditorAuditCollection(w http.ResponseWriter, r *http.Request, resource string, prefixes ...string) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	audit, total, err := h.service.ListAudit(r.Context(), tenantID, documentID, 1, 200)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(audit))
	for _, entry := range audit {
		if !matchesAnyPrefix(entry.Action, prefixes...) {
			continue
		}
		items = append(items, auditEntryResource(resource, entry))
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{
		"document_id":  documentID,
		"resource":     resource,
		"items":        items,
		"count":        len(items),
		"audit_total":  total,
		"generated_at": time.Now().UTC(),
	})
}

func (h *DocumentEditorHandler) writeEditorCapabilitySummary(w http.ResponseWriter, r *http.Request, capability string) {
	h.writeEditorCapabilitySummaryWith(w, r, capability, nil)
}

func (h *DocumentEditorHandler) writeEditorCapabilitySummaryWith(w http.ResponseWriter, r *http.Request, capability string, enrich func(map[string]any)) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.WorkspaceCapabilitySummary(r.Context(), tenantID, documentID, capability)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if enrich != nil {
		enrich(result)
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

func (h *DocumentEditorHandler) writeValidatedWorkspaceAction(w http.ResponseWriter, r *http.Request, action, resource string, status int, requiredKeyGroups [][]string, enrich func(map[string]any)) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	payload, err := decodeOptionalJSONMap(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	for _, group := range requiredKeyGroups {
		if !payloadHasAny(payload, group...) {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "missing required request field", map[string]any{"required_any_of": group})
			return
		}
	}
	if enrich != nil {
		enrich(payload)
	}
	result, err := h.service.RecordWorkspaceAction(r.Context(), tenantID, documentID, userID, action, payload)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, status, workspaceActionResponse(resource, documentID, userID, action, result, payload))
}

func editorActorFromRequest(r *http.Request, userID uuid.UUID, displayName string) service.EditorActor {
	user := auth.UserFromContext(r.Context())
	email := ""
	roles := []string(nil)
	if user != nil {
		email = user.Email
		roles = user.Roles
	}
	return service.EditorActor{
		UserID:      userID,
		Email:       email,
		DisplayName: strings.TrimSpace(displayName),
		CanWrite:    auth.HasPermissionCtx(r.Context(), roles, auth.PermLexWrite),
	}
}

func requestBaseURL(r *http.Request) string {
	proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = r.Host
	}
	if host == "" {
		return ""
	}
	return proto + "://" + host
}

func lexRoutePrefix(r *http.Request) string {
	if strings.HasPrefix(r.URL.Path, "/api/v1/watheeq/") {
		return "/api/v1/watheeq"
	}
	return "/api/v1/lex"
}

func decodeJSONMap(r *http.Request) (map[string]any, error) {
	defer r.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.UseNumber()
	var payload map[string]any
	if err := decoder.Decode(&payload); err != nil {
		return nil, err
	}
	if payload == nil {
		return nil, errors.New("request body must be a JSON object")
	}
	if decoder.More() {
		return nil, errors.New("request body must contain a single JSON object")
	}
	return payload, nil
}

func decodeOptionalJSONMap(r *http.Request) (map[string]any, error) {
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return map[string]any{}, nil
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	var payload map[string]any
	if err := decoder.Decode(&payload); err != nil {
		return nil, err
	}
	if payload == nil {
		return nil, errors.New("request body must be a JSON object")
	}
	if decoder.More() {
		return nil, errors.New("request body must contain a single JSON object")
	}
	return payload, nil
}

func decodeOptionalJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return nil
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if decoder.More() {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}

func guestReviewLinkRequestFromPayload(payload map[string]any) dto.RequestDocumentEditorGuestReviewLinkRequest {
	req := dto.RequestDocumentEditorGuestReviewLinkRequest{
		SessionID:     uuidPtrFromPayload(payload, "session_id", "sessionId"),
		ReviewerName:  stringFromPayload(payload, "reviewer_name", "reviewerName", "name"),
		ReviewerEmail: stringFromPayload(payload, "reviewer_email", "reviewerEmail", "email"),
		Organization:  stringFromPayload(payload, "organization", "company"),
		AccessMode:    accessModeFromPayload(payload),
		Sections:      stringSliceFromPayload(payload, "sections", "section_ids", "sectionIds"),
		Message:       stringFromPayload(payload, "message", "body"),
		Metadata:      metadataFromPayload(payload),
	}
	if seconds := intPtrFromPayload(payload, "expires_in_seconds", "expiresInSeconds"); seconds != nil {
		req.ExpiresInSeconds = seconds
	} else if expiresAt := timePtrFromPayload(payload, "expires_at", "expiresAt"); expiresAt != nil {
		seconds := int(time.Until(*expiresAt).Seconds())
		if seconds > 0 {
			req.ExpiresInSeconds = &seconds
		}
	}
	return req
}

func guestReviewLinkResponse(result any) map[string]any {
	if typed, ok := result.(*model.DocumentEditorGuestReviewLinkRequestResult); ok {
		role := "commenter"
		permissions := []string{"view", "comment"}
		if typed.AccessMode == model.DocumentEditorModeView {
			role = "viewer"
			permissions = []string{"view"}
		}
		return map[string]any{
			"id":             typed.RequestID,
			"document_id":    typed.DocumentID,
			"reviewer_name":  typed.Reviewer.Name,
			"reviewer_email": typed.Reviewer.Email,
			"role":           role,
			"permissions":    permissions,
			"status":         typed.Status,
			"expires_at":     typed.ExpiresAt,
			"created_at":     typed.CreatedAt,
			"metadata":       typed.Metadata,
		}
	}
	return map[string]any{}
}

func negotiationRoomResponse(result *model.DocumentEditorNegotiationRoomSummary) map[string]any {
	openItems := len(result.PendingItems)
	response := map[string]any{
		"document":        result.Document,
		"document_id":     result.Document.ID,
		"status":          result.Status,
		"phase":           result.Phase,
		"summary":         result.Summary,
		"next_step":       result.NextStep,
		"participants":    participantsResponse(result.Participants),
		"messages":        []map[string]any{},
		"pending_items":   result.PendingItems,
		"open_items":      openItems,
		"active_lock":     result.ActiveLock,
		"active_sessions": result.ActiveSessions,
		"recent_activity": result.RecentActivity,
		"updated_at":      result.GeneratedAt,
		"metadata":        result.Metadata,
		"generated_at":    result.GeneratedAt,
	}
	return response
}

func playbookEnforcementResponse(result *model.DocumentEditorPlaybookEnforcementSummary) map[string]any {
	deviations := append([]model.DocumentEditorWorkspaceItem{}, result.MissingClauses...)
	deviations = append(deviations, result.Deviations...)
	score := any(nil)
	if result.ClauseCount > 0 {
		gaps := len(result.MissingClauses) + len(result.Deviations)
		calculated := 100 - (gaps * 100 / result.ClauseCount)
		if calculated < 0 {
			calculated = 0
		}
		score = calculated
	}
	return map[string]any{
		"document":               result.Document,
		"document_id":            result.Document.ID,
		"contract_id":            result.ContractID,
		"playbook_id":            result.PlaybookID,
		"playbook_name":          result.PlaybookName,
		"status":                 playbookStatusForClient(result.Status),
		"score":                  score,
		"deviations":             workspaceItemsAsDeviations(deviations),
		"checked_at":             result.GeneratedAt,
		"clause_count":           result.ClauseCount,
		"high_risk_clause_count": result.HighRiskClauseCount,
		"required_clauses":       result.RequiredClauses,
		"matched_clauses":        result.MatchedClauses,
		"missing_clauses":        result.MissingClauses,
		"metadata":               result.Metadata,
		"generated_at":           result.GeneratedAt,
	}
}

func termsCrossReferencesResponse(result *model.DocumentEditorNavigatorSummary) map[string]any {
	issues := make([]map[string]any, 0, result.BrokenReferenceCount)
	for _, reference := range result.CrossReferences {
		if reference.Status != "broken" && reference.Status != "missing" {
			continue
		}
		issues = append(issues, map[string]any{
			"id":         stableResponseID("reference", reference.Reference),
			"severity":   "high",
			"message":    firstNonEmptyString(reference.Reference, "Cross-reference") + " could not be resolved",
			"section_id": reference.SectionReference,
			"metadata":   reference.Metadata,
		})
	}
	return map[string]any{
		"document":               result.Document,
		"document_id":            result.Document.ID,
		"terms":                  definedTermsResponse(result.DefinedTerms),
		"defined_terms":          result.DefinedTerms,
		"cross_references":       crossReferencesResponse(result.CrossReferences),
		"broken_reference_count": result.BrokenReferenceCount,
		"issues":                 issues,
		"checked_at":             result.GeneratedAt,
		"metadata":               result.Metadata,
		"generated_at":           result.GeneratedAt,
	}
}

func sectionAssignmentsResponse(result *model.DocumentEditorSectionAssignmentsSummary) []map[string]any {
	assignments := make([]map[string]any, 0, len(result.Assignments))
	for _, item := range result.Assignments {
		assignments = append(assignments, map[string]any{
			"id":                firstNonEmptyString(item.ID, stableResponseID("assignment", item.Title, item.SectionReference)),
			"document_id":       result.Document.ID,
			"section_id":        firstNonEmptyString(item.SectionID, item.SectionReference, item.Title),
			"section_title":     item.Title,
			"section_reference": item.SectionReference,
			"assignee_user_id":  item.AssigneeID,
			"assignee_name":     item.AssigneeName,
			"role":              item.Role,
			"status":            item.Status,
			"due_at":            item.DueAt,
			"notes":             "",
			"metadata":          item.Metadata,
		})
	}
	return assignments
}

func legalIssuesResponse(result *model.DocumentEditorLegalIssuesSummary) []map[string]any {
	issues := make([]map[string]any, 0, len(result.Issues))
	for _, issue := range result.Issues {
		issues = append(issues, map[string]any{
			"id":           firstNonEmptyString(issue.ID, stableResponseID("issue", issue.Title, issue.SectionReference)),
			"document_id":  result.Document.ID,
			"issue_type":   firstNonEmptyString(issue.Source, "legal_review"),
			"title":        issue.Title,
			"description":  issue.Description,
			"severity":     issue.Severity,
			"status":       issue.Status,
			"clause_id":    issue.ClauseID,
			"section_id":   issue.SectionReference,
			"owner_name":   issue.Owner,
			"created_at":   result.GeneratedAt,
			"resolved_at":  nil,
			"metadata":     issue.Metadata,
			"source":       issue.Source,
			"section_ref":  issue.SectionReference,
			"summary_open": result.OpenCount,
		})
	}
	return issues
}

func signatureReadinessResponse(result *model.DocumentEditorSignatureReadinessSummary) map[string]any {
	checks := make([]map[string]any, 0, len(result.Blockers)+1)
	for _, blocker := range result.Blockers {
		checks = append(checks, map[string]any{
			"key":      firstNonEmptyString(blocker.Key, stableResponseID("signature", blocker.Title)),
			"status":   "failed",
			"severity": firstNonEmptyString(blocker.Severity, "high"),
			"message":  blocker.Title,
			"metadata": blocker.Metadata,
		})
	}
	if len(checks) == 0 {
		checks = append(checks, map[string]any{
			"key":     "signature_readiness",
			"status":  "passed",
			"message": "No signature blockers are currently reported",
		})
	}
	score := 100
	if len(result.Blockers) > 0 {
		score = 100 - len(result.Blockers)*20
		if score < 0 {
			score = 0
		}
	}
	return map[string]any{
		"document":        result.Document,
		"document_id":     result.Document.ID,
		"ready":           result.Ready,
		"status":          result.Status,
		"score":           score,
		"checks":          checks,
		"checked_at":      result.GeneratedAt,
		"envelope_id":     result.EnvelopeID,
		"envelope_status": result.EnvelopeStatus,
		"provider":        result.Provider,
		"method":          result.Method,
		"signer_count":    result.SignerCount,
		"signed_count":    result.SignedCount,
		"signers":         result.Signers,
		"blockers":        result.Blockers,
		"metadata":        result.Metadata,
		"generated_at":    result.GeneratedAt,
	}
}

func clauseAIActionResponse(result *model.DocumentEditorClauseAIActionRequestResult) map[string]any {
	return map[string]any{
		"request_id":        result.RequestID,
		"action_id":         result.RequestID,
		"document_id":       result.DocumentID,
		"session_id":        result.SessionID,
		"action":            result.Action,
		"clause_id":         result.ClauseID,
		"clause_type":       result.ClauseType,
		"section_reference": result.SectionReference,
		"section_id":        result.SectionReference,
		"status":            result.Status,
		"audit_action":      result.AuditAction,
		"result_text":       nil,
		"changes":           []map[string]any{},
		"citations":         []map[string]any{},
		"metadata":          result.Metadata,
		"created_at":        result.CreatedAt,
	}
}

func healthScoreResponse(result *model.DocumentEditorHealthScore) map[string]any {
	recommendations := make([]string, 0, len(result.Signals))
	for _, signal := range result.Signals {
		if signal.Title != "" {
			recommendations = append(recommendations, signal.Title)
		}
	}
	return map[string]any{
		"document":        result.Document,
		"document_id":     result.Document.ID,
		"score":           result.Score,
		"grade":           healthGrade(result.Score),
		"status":          healthStatusForClient(result.Status),
		"dimensions":      healthDimensionsResponse(result.Checks),
		"checks":          result.Checks,
		"signals":         result.Signals,
		"recommendations": recommendations,
		"checked_at":      result.GeneratedAt,
		"metadata":        result.Metadata,
		"generated_at":    result.GeneratedAt,
	}
}

func privilegedControlsResponse(result *model.DocumentEditorPrivilegedControlsSummary) map[string]any {
	warnings := make([]string, 0, len(result.Holds))
	for _, hold := range result.Holds {
		if hold.Title != "" {
			warnings = append(warnings, hold.Title)
		}
	}
	return map[string]any{
		"document":                 result.Document,
		"document_id":              result.Document.ID,
		"privileged":               result.Privileged,
		"access_level":             privilegedAccessLevel(result),
		"privilege_basis":          string(result.Confidentiality),
		"ethical_wall":             result.ApprovalRequired && result.Privileged,
		"allowed_user_ids":         []string{},
		"denied_user_ids":          []string{},
		"watermark":                result.WatermarkRequired,
		"copy_download_allowed":    result.CopyAllowed && result.DownloadAllowed,
		"external_sharing_allowed": result.ExternalSharingAllowed,
		"retention_hold":           len(result.Holds) > 0,
		"warnings":                 warnings,
		"updated_at":               result.GeneratedAt,
		"confidentiality":          result.Confidentiality,
		"download_allowed":         result.DownloadAllowed,
		"print_allowed":            result.PrintAllowed,
		"copy_allowed":             result.CopyAllowed,
		"approval_required":        result.ApprovalRequired,
		"controls":                 result.Controls,
		"holds":                    result.Holds,
		"metadata":                 result.Metadata,
		"generated_at":             result.GeneratedAt,
	}
}

func participantsResponse(participants []model.DocumentEditorParticipant) []map[string]any {
	out := make([]map[string]any, 0, len(participants))
	for _, participant := range participants {
		out = append(out, map[string]any{
			"id":           participant.UserID,
			"user_id":      participant.UserID,
			"name":         participant.Name,
			"email":        participant.Email,
			"organization": participant.Organization,
			"role":         participant.Role,
			"side":         participantSide(participant),
			"status":       participant.Status,
			"metadata":     participant.Metadata,
		})
	}
	return out
}

func participantSide(participant model.DocumentEditorParticipant) string {
	if participant.External {
		return "external"
	}
	return "internal"
}

func workspaceItemsAsDeviations(items []model.DocumentEditorWorkspaceItem) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{
			"id":              firstNonEmptyString(item.Key, stableResponseID("deviation", item.Title, item.SectionReference)),
			"section_id":      item.SectionReference,
			"clause_type":     item.Key,
			"severity":        firstNonEmptyString(item.Severity, "medium"),
			"title":           item.Title,
			"description":     item.Source,
			"required_action": item.Owner,
			"status":          firstNonEmptyString(item.Status, "open"),
			"metadata":        item.Metadata,
		})
	}
	return out
}

func definedTermsResponse(terms []model.DocumentEditorDefinedTerm) []map[string]any {
	out := make([]map[string]any, 0, len(terms))
	for _, term := range terms {
		status := "defined"
		if term.Definition == "" {
			status = "undefined"
		}
		out = append(out, map[string]any{
			"id":               stableResponseID("term", term.Term),
			"term":             term.Term,
			"definition":       term.Definition,
			"occurrences":      term.Occurrences,
			"first_section_id": term.SectionReference,
			"status":           status,
			"metadata":         term.Metadata,
		})
	}
	return out
}

func crossReferencesResponse(references []model.DocumentEditorCrossReference) []map[string]any {
	out := make([]map[string]any, 0, len(references))
	for _, reference := range references {
		out = append(out, map[string]any{
			"id":                stableResponseID("reference", reference.Reference, reference.Target),
			"source_section_id": reference.SectionReference,
			"target_section_id": reference.Target,
			"label":             reference.Reference,
			"status":            crossReferenceStatusForClient(reference.Status),
			"message":           "",
			"metadata":          reference.Metadata,
		})
	}
	return out
}

func healthDimensionsResponse(checks []model.DocumentEditorHealthCheck) []map[string]any {
	out := make([]map[string]any, 0, len(checks))
	for _, check := range checks {
		out = append(out, map[string]any{
			"key":      check.Key,
			"label":    strings.ReplaceAll(check.Key, "_", " "),
			"score":    healthDimensionScore(check),
			"status":   healthCheckStatusForClient(check.Status),
			"findings": []string{check.Message},
			"metadata": check.Metadata,
		})
	}
	return out
}

func healthDimensionScore(check model.DocumentEditorHealthCheck) int {
	switch strings.ToLower(check.Status) {
	case "passed", "ok", "healthy":
		return 100
	case "failed", "blocked", "critical":
		return 25
	case "warning", "needs_review":
		return 65
	default:
		if check.ScoreImpact < 0 {
			return 75
		}
		return 90
	}
}

func playbookStatusForClient(status string) string {
	switch strings.ToLower(status) {
	case "passed", "complete", "completed":
		return "passed"
	case "blocked", "failed":
		return "blocked"
	default:
		return "needs_review"
	}
}

func crossReferenceStatusForClient(status string) string {
	switch strings.ToLower(status) {
	case "broken", "missing":
		return "broken"
	case "ambiguous", "stale":
		return "ambiguous"
	case "valid", "referenced", "ok":
		return "valid"
	default:
		return firstNonEmptyString(status, "valid")
	}
}

func healthStatusForClient(status string) string {
	switch strings.ToLower(status) {
	case "healthy", "good", "passed":
		return "healthy"
	case "critical", "blocked", "failed":
		return "critical"
	default:
		return "needs_review"
	}
}

func healthCheckStatusForClient(status string) string {
	switch strings.ToLower(status) {
	case "passed", "ok", "healthy":
		return "good"
	case "failed", "blocked", "critical":
		return "critical"
	default:
		return "warning"
	}
}

func healthGrade(score float64) string {
	switch {
	case score >= 90:
		return "A"
	case score >= 80:
		return "B"
	case score >= 70:
		return "C"
	case score >= 60:
		return "D"
	default:
		return "F"
	}
}

func privilegedAccessLevel(result *model.DocumentEditorPrivilegedControlsSummary) string {
	if result.Privileged && result.ApprovalRequired {
		return "ethical_wall"
	}
	if result.Privileged || result.Confidentiality == model.DocumentConfidentialityConfidential {
		return "restricted"
	}
	return "standard"
}

func stableResponseID(parts ...string) string {
	joined := strings.ToLower(strings.Join(parts, "-"))
	replacer := strings.NewReplacer(" ", "-", "_", "-", "/", "-", "\\", "-", ":", "-", ".", "-")
	joined = replacer.Replace(joined)
	segments := strings.Split(joined, "-")
	out := make([]string, 0, len(segments))
	for _, segment := range segments {
		segment = strings.TrimSpace(segment)
		if segment != "" {
			out = append(out, segment)
		}
	}
	if len(out) == 0 {
		return "item"
	}
	return strings.Join(out, "-")
}

func legalIssueResponse(documentID uuid.UUID, result, payload map[string]any, status string) map[string]any {
	return map[string]any{
		"id":            firstNonEmptyString(stringFromPayload(payload, "id"), stringFromPayload(result, "request_id")),
		"document_id":   documentID,
		"issue_type":    firstNonEmptyString(stringFromPayload(payload, "issue_type", "issueType", "type"), "manual"),
		"title":         firstNonEmptyString(stringFromPayload(payload, "title"), "Legal issue"),
		"description":   stringFromPayload(payload, "description", "summary"),
		"severity":      firstNonEmptyString(stringFromPayload(payload, "severity"), "medium"),
		"status":        status,
		"clause_id":     stringFromPayload(payload, "clause_id", "clauseId"),
		"section_id":    stringFromPayload(payload, "section_id", "sectionId", "section_reference", "sectionReference"),
		"owner_user_id": stringFromPayload(payload, "owner_user_id", "ownerUserId"),
		"owner_name":    stringFromPayload(payload, "owner_name", "ownerName", "owner"),
		"due_at":        stringFromPayload(payload, "due_at", "dueAt"),
		"created_at":    result["created_at"],
		"resolved_at":   resolvedAtForStatus(status, result),
		"metadata":      metadataFromPayload(payload),
	}
}

func resolvedAtForStatus(status string, result map[string]any) any {
	if strings.EqualFold(status, "resolved") {
		return result["created_at"]
	}
	return nil
}

func accessModeFromPayload(payload map[string]any) model.DocumentEditorMode {
	raw := strings.ToLower(firstNonEmptyString(
		stringFromPayload(payload, "access_mode", "accessMode", "access"),
		stringFromPayload(payload, "role"),
	))
	for _, permission := range stringSliceFromPayload(payload, "permissions") {
		lower := strings.ToLower(permission)
		if lower == "comment" || lower == "commenter" {
			return model.DocumentEditorModeComment
		}
	}
	switch raw {
	case "view", "viewer", "read", "read_only":
		return model.DocumentEditorModeView
	default:
		return model.DocumentEditorModeComment
	}
}

func metadataFromPayload(payload map[string]any) map[string]any {
	if metadata, ok := payload["metadata"].(map[string]any); ok {
		return metadata
	}
	metadata := make(map[string]any, len(payload))
	for key, value := range payload {
		if key == "metadata" {
			continue
		}
		metadata[key] = value
	}
	return metadata
}

func stringFromPayload(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		switch value := payload[key].(type) {
		case string:
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				return trimmed
			}
		case json.Number:
			if text := strings.TrimSpace(value.String()); text != "" {
				return text
			}
		case uuid.UUID:
			if value != uuid.Nil {
				return value.String()
			}
		}
	}
	return ""
}

func payloadHasAny(payload map[string]any, keys ...string) bool {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok || payloadValueEmpty(value) {
			continue
		}
		return true
	}
	return false
}

func payloadValueEmpty(value any) bool {
	switch v := value.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(v) == ""
	case []any:
		return len(v) == 0
	case []string:
		return len(v) == 0
	case map[string]any:
		return len(v) == 0
	default:
		return false
	}
}

func providerFromRequest(r *http.Request, payload map[string]any) string {
	return strings.ToLower(firstNonEmptyString(
		strings.TrimSpace(chi.URLParam(r, "provider")),
		strings.TrimSpace(r.URL.Query().Get("provider")),
		strings.TrimSpace(r.Header.Get("X-Lex-Editor-Provider")),
		strings.TrimSpace(r.Header.Get("X-Onlyoffice-Provider")),
		stringFromPayload(payload, "provider"),
		"onlyoffice",
	))
}

func tokenFingerprint(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])[:16]
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func uuidPtrFromPayload(payload map[string]any, keys ...string) *uuid.UUID {
	for _, key := range keys {
		if parsed, ok := uuidFromValue(payload[key]); ok {
			return &parsed
		}
	}
	return nil
}

func uuidFromValue(value any) (uuid.UUID, bool) {
	switch v := value.(type) {
	case uuid.UUID:
		return v, v != uuid.Nil
	case string:
		parsed, err := uuid.Parse(strings.TrimSpace(v))
		return parsed, err == nil
	default:
		return uuid.Nil, false
	}
}

func intPtrFromPayload(payload map[string]any, keys ...string) *int {
	for _, key := range keys {
		switch value := payload[key].(type) {
		case int:
			return &value
		case float64:
			converted := int(value)
			return &converted
		case json.Number:
			if parsed, err := value.Int64(); err == nil {
				converted := int(parsed)
				return &converted
			}
		case string:
			if parsed, err := time.ParseDuration(strings.TrimSpace(value)); err == nil {
				converted := int(parsed.Seconds())
				return &converted
			}
		}
	}
	return nil
}

func timePtrFromPayload(payload map[string]any, keys ...string) *time.Time {
	for _, key := range keys {
		raw := stringFromPayload(payload, key)
		if raw == "" {
			continue
		}
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02"} {
			if parsed, err := time.Parse(layout, raw); err == nil {
				return &parsed
			}
		}
	}
	return nil
}

func stringSliceFromPayload(payload map[string]any, keys ...string) []string {
	for _, key := range keys {
		switch value := payload[key].(type) {
		case []string:
			return compactStrings(value)
		case []any:
			values := make([]string, 0, len(value))
			for _, item := range value {
				switch typed := item.(type) {
				case string:
					values = append(values, typed)
				case json.Number:
					values = append(values, typed.String())
				}
			}
			if len(values) > 0 {
				return compactStrings(values)
			}
		case string:
			if value != "" {
				return compactStrings(strings.Split(value, ","))
			}
		}
	}
	return nil
}

func compactStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func workspaceActionResponse(resource string, documentID, userID uuid.UUID, action string, result, payload map[string]any) map[string]any {
	return map[string]any{
		"id":           firstNonEmptyString(stringFromPayload(result, "request_id"), stringFromPayload(payload, "id")),
		"request_id":   result["request_id"],
		"document_id":  documentID,
		"actor_id":     userID,
		"resource":     resource,
		"action":       action,
		"status":       result["status"],
		"payload":      payload,
		"metadata":     metadataFromPayload(payload),
		"audit_action": result["audit_action"],
		"created_at":   result["created_at"],
	}
}

func guestPortalTokenResponse(token, status string, payload map[string]any) map[string]any {
	expiresAt := timePtrFromPayload(payload, "expires_at", "expiresAt")
	valid := true
	reason := "accepted"
	if expiresAt != nil && !expiresAt.After(time.Now().UTC()) {
		valid = false
		reason = "expired"
	}
	if strings.EqualFold(stringFromPayload(payload, "status"), "revoked") {
		valid = false
		reason = "revoked"
	}
	return map[string]any{
		"token_fingerprint": tokenFingerprint(token),
		"status":            status,
		"valid":             valid,
		"reason":            reason,
		"permissions":       []string{"view", "comment"},
		"watermark":         true,
		"expires_at":        expiresAt,
		"metadata": map[string]any{
			"revocation_enforced":        true,
			"expiry_enforced":            true,
			"persistent_lookup_required": true,
			"raw_token_returned":         false,
		},
	}
}

func auditEntryResource(resource string, entry model.DocumentEditorAuditEntry) map[string]any {
	return map[string]any{
		"id":          entry.ID,
		"document_id": entry.DocumentID,
		"session_id":  entry.SessionID,
		"resource":    resource,
		"action":      entry.Action,
		"actor_id":    entry.ActorUserID,
		"status":      statusFromAuditDetail(entry.Detail),
		"title":       titleFromAuditDetail(resource, entry.Detail),
		"detail":      entry.Detail,
		"metadata":    entry.Detail,
		"created_at":  entry.CreatedAt,
	}
}

func statusFromAuditDetail(detail map[string]any) string {
	return firstNonEmptyString(
		stringFromPayload(detail, "status"),
		stringFromPayload(detail, "state"),
		"open",
	)
}

func titleFromAuditDetail(resource string, detail map[string]any) string {
	return firstNonEmptyString(
		stringFromPayload(detail, "title"),
		stringFromPayload(detail, "label"),
		stringFromPayload(detail, "name"),
		strings.ReplaceAll(resource, "_", " "),
	)
}

func matchesAnyPrefix(value string, prefixes ...string) bool {
	if len(prefixes) == 0 {
		return true
	}
	value = strings.ToLower(strings.TrimSpace(value))
	for _, prefix := range prefixes {
		if strings.HasPrefix(value, strings.ToLower(strings.TrimSpace(prefix))) {
			return true
		}
	}
	return false
}

func editorAnalyticsResponse(documentID uuid.UUID, audit []model.DocumentEditorAuditEntry) map[string]any {
	counts := map[string]int{
		"provider_events":       0,
		"revisions":             0,
		"unresolved_issues":     0,
		"playbook_deviations":   0,
		"approval_requests":     0,
		"guest_activity":        0,
		"signature_blockers":    0,
		"ai_change_requests":    0,
		"offline_recovery_runs": 0,
	}
	var first, last *time.Time
	for _, entry := range audit {
		createdAt := entry.CreatedAt
		if first == nil || createdAt.Before(*first) {
			copy := createdAt
			first = &copy
		}
		if last == nil || createdAt.After(*last) {
			copy := createdAt
			last = &copy
		}
		action := strings.ToLower(entry.Action)
		switch {
		case strings.Contains(action, "provider_event"):
			counts["provider_events"]++
		case strings.Contains(action, "snapshot") || strings.Contains(action, "callback"):
			counts["revisions"]++
		case strings.Contains(action, "legal_issue") && !strings.Contains(action, "resolved"):
			counts["unresolved_issues"]++
		case strings.Contains(action, "playbook") || strings.Contains(action, "deviation"):
			counts["playbook_deviations"]++
		case strings.Contains(action, "approval"):
			counts["approval_requests"]++
		case strings.Contains(action, "guest"):
			counts["guest_activity"]++
		case strings.Contains(action, "signature"):
			counts["signature_blockers"]++
		case strings.Contains(action, "ai_change") || strings.Contains(action, "clause_ai"):
			counts["ai_change_requests"]++
		case strings.Contains(action, "offline_recovery"):
			counts["offline_recovery_runs"]++
		}
	}
	cycleHours := 0.0
	if first != nil && last != nil {
		cycleHours = last.Sub(*first).Hours()
	}
	return map[string]any{
		"document_id":        documentID,
		"counts":             counts,
		"cycle_time_hours":   cycleHours,
		"first_activity_at":  first,
		"latest_activity_at": last,
		"events_sampled":     len(audit),
		"generated_at":       time.Now().UTC(),
	}
}
