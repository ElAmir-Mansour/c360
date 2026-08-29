package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

const (
	defaultEditorSessionTTL = 12 * time.Hour
	defaultEditorLockTTL    = 30 * time.Minute
	maxEditorLockTTL        = 24 * time.Hour
	defaultGuestReviewTTL   = 7 * 24 * time.Hour
	maxGuestReviewTTL       = 30 * 24 * time.Hour
)

type EditorActor struct {
	UserID      uuid.UUID
	Email       string
	DisplayName string
	CanWrite    bool
}

type DocumentEditorService struct {
	db        *pgxpool.Pool
	editors   *repository.DocumentEditorRepository
	publisher Publisher
	topic     string
	logger    zerolog.Logger
	now       func() time.Time
}

func NewDocumentEditorService(db *pgxpool.Pool, editors *repository.DocumentEditorRepository, publisher Publisher, topic string, logger zerolog.Logger) *DocumentEditorService {
	return &DocumentEditorService{
		db:        db,
		editors:   editors,
		publisher: publisherOrNoop(publisher),
		topic:     topic,
		logger:    logger.With().Str("service", "lex-document-editor").Logger(),
		now:       time.Now,
	}
}

func (s *DocumentEditorService) OpenSession(ctx context.Context, tenantID, documentID uuid.UUID, actor EditorActor, req dto.OpenDocumentEditorSessionRequest) (*model.DocumentEditorOpenResult, error) {
	req.Normalize()
	if !req.Mode.Valid() {
		return nil, validationError("mode must be edit, comment, or view", map[string]string{"mode": "invalid"})
	}
	if !validEditorProvider(req.Provider) {
		return nil, validationError("provider is invalid", map[string]string{"provider": "invalid"})
	}
	if (req.Mode == model.DocumentEditorModeEdit || req.Mode == model.DocumentEditorModeComment) && !actor.CanWrite {
		return nil, forbiddenError("write permission is required for edit or comment mode")
	}

	var result *model.DocumentEditorOpenResult
	callbackToken := uuid.NewString()
	callbackTokenHash := hashEditorCallbackToken(callbackToken)

	err := database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		document, err := s.editors.GetDocumentForEditor(ctx, tx, tenantID, documentID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return notFoundError("document not found")
			}
			return internalError("load editor document", err)
		}
		if document.FileID == nil && strings.TrimSpace(req.DocumentURL) == "" {
			return validationError("document has no editable file", map[string]string{"file_id": "required"})
		}

		if err := s.editors.ExpireDocumentLocks(ctx, tx, tenantID, documentID); err != nil {
			return internalError("expire editor locks", err)
		}
		activeLock, err := s.editors.GetActiveLock(ctx, tx, tenantID, documentID)
		if err != nil && err != pgx.ErrNoRows {
			return internalError("load editor lock", err)
		}
		if err == pgx.ErrNoRows {
			activeLock = nil
		}

		permissionMode := effectiveEditorPermissionMode(req.Mode, actor.UserID, activeLock)
		callbackURL := strings.TrimSpace(req.CallbackURL)
		sessionID := uuid.New()
		if callbackURL == "" {
			callbackURL = buildEditorCallbackURL(req.BaseURL, req.RoutePrefix, documentID, sessionID)
		}
		callbackURL = decorateEditorCallbackURL(callbackURL, sessionID, callbackToken)
		tokenHashValue := callbackTokenHash
		session := &model.DocumentEditorSession{
			ID:                  sessionID,
			TenantID:            tenantID,
			DocumentID:          documentID,
			Provider:            req.Provider,
			RequestedMode:       req.Mode,
			PermissionMode:      permissionMode,
			Status:              model.DocumentEditorSessionActive,
			ProviderDocumentKey: buildEditorProviderDocumentKey(tenantID, documentID, document.CurrentVersion),
			DocumentVersion:     document.CurrentVersion,
			CallbackURL:         normalizeOptionalString(&callbackURL),
			CallbackTokenHash:   &tokenHashValue,
			AutosaveMetadata: map[string]any{
				"autosave":   true,
				"forcesave":  true,
				"created_at": s.now().UTC().Format(time.RFC3339),
			},
			LastCallback:     map[string]any{},
			PreflightResult:  map[string]any{},
			SnapshotMetadata: map[string]any{},
			CreatedBy:        actor.UserID,
			ExpiresAt:        editorPtrTime(s.now().UTC().Add(defaultEditorSessionTTL)),
		}
		if err := s.editors.CreateSession(ctx, tx, session); err != nil {
			return internalError("create editor session", err)
		}
		auditDetail := map[string]any{
			"requested_mode":   string(req.Mode),
			"permission_mode":  string(permissionMode),
			"provider":         req.Provider,
			"document_version": document.CurrentVersion,
		}
		if activeLock != nil {
			auditDetail["active_lock_id"] = activeLock.ID.String()
			auditDetail["locked_by"] = activeLock.LockedBy.String()
		}
		if err := s.appendAudit(ctx, tx, tenantID, documentID, &session.ID, nil, "editor.session_opened", req.Provider, &actor.UserID, auditDetail); err != nil {
			return err
		}

		result = &model.DocumentEditorOpenResult{
			Session:  session,
			Document: editorDocumentSummary(document),
			Lock:     activeLock,
			Config:   buildDocumentEditorConfig(document, session, activeLock, actor, req, callbackToken),
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.document.editor_session_opened", tenantID, &actor.UserID, map[string]any{
		"id":              result.Session.ID,
		"document_id":     documentID,
		"provider":        result.Session.Provider,
		"permission_mode": result.Session.PermissionMode,
	}, s.logger)
	return result, nil
}

func (s *DocumentEditorService) HandleCallback(ctx context.Context, tenantID, documentID uuid.UUID, actorID *uuid.UUID, payload map[string]any) (*model.DocumentEditorCallbackResult, error) {
	if payload == nil {
		return nil, validationError("callback payload is required", map[string]string{"payload": "required"})
	}
	provider := strings.ToLower(strings.TrimSpace(stringFromAny(payload["provider"])))
	if provider == "" {
		provider = "onlyoffice"
	}
	if !validEditorProvider(provider) {
		return nil, validationError("provider is invalid", map[string]string{"provider": "invalid"})
	}
	if _, ok := payload["status"]; !ok {
		return nil, validationError("callback status is required", map[string]string{"status": "required"})
	}

	var result *model.DocumentEditorCallbackResult
	err := database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		if _, err := s.editors.GetDocumentForEditor(ctx, tx, tenantID, documentID); err != nil {
			if err == pgx.ErrNoRows {
				return notFoundError("document not found")
			}
			return internalError("load editor document", err)
		}
		session, err := s.resolveCallbackSession(ctx, tx, tenantID, documentID, provider, payload)
		if err != nil {
			return err
		}
		if callbackToken := strings.TrimSpace(stringFromAny(payload["callback_token"])); callbackToken != "" {
			callbackTokenHash, err := s.editors.GetSessionCallbackTokenHash(ctx, tx, tenantID, session.ID)
			if err != nil {
				return internalError("load editor callback token hash", err)
			}
			if callbackTokenHash == nil || hashEditorCallbackToken(callbackToken) != *callbackTokenHash {
				return forbiddenError("callback token is invalid")
			}
		}
		receivedAt := s.now().UTC().Format(time.RFC3339)
		callbackMetadata := copyStringAnyMap(payload)
		callbackMetadata["received_at"] = receivedAt
		callbackMetadata["provider"] = provider
		providerEventID := firstNonEmpty(stringFromAny(firstAny(payload, "event_id", "eventId", "callback_id", "callbackId")), "")
		providerEvent := &model.DocumentEditorProviderEvent{
			ID:              uuid.New(),
			TenantID:        tenantID,
			DocumentID:      documentID,
			SessionID:       &session.ID,
			Provider:        provider,
			ProviderEventID: normalizeOptionalString(&providerEventID),
			EventType:       editorProviderEventType(payload),
			Status:          "received",
			Payload:         callbackMetadata,
			ReceivedAt:      s.now().UTC(),
		}
		if err := s.editors.AppendProviderEvent(ctx, tx, providerEvent); err != nil {
			return internalError("record editor provider event", err)
		}
		autosaveMetadata := map[string]any{
			"last_status": payload["status"],
			"received_at": receivedAt,
			"users":       payload["users"],
		}
		if forceSaveType, ok := payload["forcesavetype"]; ok {
			autosaveMetadata["force_save_type"] = forceSaveType
		}
		snapshotRequested := isEditorSnapshotStatus(payload["status"])
		snapshotMetadata := copyStringAnyMap(session.SnapshotMetadata)
		if snapshotRequested {
			snapshotMetadata = map[string]any{
				"requested":          true,
				"requested_at":       receivedAt,
				"provider":           provider,
				"provider_status":    payload["status"],
				"source_url_present": strings.TrimSpace(stringFromAny(payload["url"])) != "",
				"hook":               "document_version_snapshot_placeholder",
			}
		}
		updated, err := s.editors.UpdateSessionCallback(ctx, tx, tenantID, session.ID, callbackMetadata, autosaveMetadata, snapshotMetadata)
		if err != nil {
			return internalError("record editor callback", err)
		}
		if err := s.appendAudit(ctx, tx, tenantID, documentID, &session.ID, nil, "editor.callback_received", provider, actorID, map[string]any{
			"status":                     payload["status"],
			"provider_document_key":      payload["key"],
			"version_snapshot_requested": snapshotRequested,
		}); err != nil {
			return err
		}
		if snapshotRequested {
			if err := s.appendAudit(ctx, tx, tenantID, documentID, &session.ID, nil, "editor.version_snapshot_requested", provider, actorID, snapshotMetadata); err != nil {
				return err
			}
		}
		result = &model.DocumentEditorCallbackResult{Session: updated, VersionSnapshotRequested: snapshotRequested}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *DocumentEditorService) AcquireLock(ctx context.Context, tenantID, documentID, userID uuid.UUID, req dto.AcquireDocumentEditorLockRequest) (*model.DocumentEditorLock, error) {
	req.Normalize()
	if req.LockType != "checkout" && req.LockType != "edit" {
		return nil, validationError("lock_type must be checkout or edit", map[string]string{"lock_type": "invalid"})
	}
	var lock *model.DocumentEditorLock
	err := database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		if _, err := s.editors.GetDocumentForEditor(ctx, tx, tenantID, documentID); err != nil {
			if err == pgx.ErrNoRows {
				return notFoundError("document not found")
			}
			return internalError("load editor document", err)
		}
		if req.SessionID != nil {
			session, err := s.editors.GetSession(ctx, tx, tenantID, *req.SessionID)
			if err != nil {
				if err == pgx.ErrNoRows {
					return validationError("session_id was not found", map[string]string{"session_id": "not_found"})
				}
				return internalError("load editor session", err)
			}
			if session.DocumentID != documentID {
				return validationError("session_id does not belong to this document", map[string]string{"session_id": "mismatch"})
			}
		}
		if err := s.editors.ExpireDocumentLocks(ctx, tx, tenantID, documentID); err != nil {
			return internalError("expire editor locks", err)
		}
		active, err := s.editors.GetActiveLock(ctx, tx, tenantID, documentID)
		if err != nil && err != pgx.ErrNoRows {
			return internalError("load editor lock", err)
		}
		if err == nil {
			if active.LockedBy == userID {
				lock = active
				return nil
			}
			return conflictError("document is locked by another user")
		}
		newLock := &model.DocumentEditorLock{
			ID:         uuid.New(),
			TenantID:   tenantID,
			DocumentID: documentID,
			SessionID:  req.SessionID,
			LockType:   req.LockType,
			Status:     model.DocumentEditorLockActive,
			Reason:     req.Reason,
			LockedBy:   userID,
			ExpiresAt:  editorPtrTime(s.now().UTC().Add(editorLockTTL(req.ExpiresInSeconds))),
			Metadata:   req.Metadata,
		}
		if err := s.editors.CreateLock(ctx, tx, newLock); err != nil {
			if isUniqueViolation(err) {
				return conflictError("document is locked by another user")
			}
			return internalError("create editor lock", err)
		}
		if err := s.appendAudit(ctx, tx, tenantID, documentID, req.SessionID, &newLock.ID, "editor.lock_acquired", "", &userID, map[string]any{
			"lock_type":  req.LockType,
			"reason":     req.Reason,
			"expires_at": newLock.ExpiresAt,
		}); err != nil {
			return err
		}
		lock = newLock
		return nil
	})
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.document.editor_locked", tenantID, &userID, map[string]any{
		"id":          lock.ID,
		"document_id": documentID,
		"lock_type":   lock.LockType,
	}, s.logger)
	return lock, nil
}

func (s *DocumentEditorService) ReleaseLock(ctx context.Context, tenantID, documentID, userID uuid.UUID, req dto.ReleaseDocumentEditorLockRequest) (*model.DocumentEditorLock, error) {
	req.Normalize()
	var released *model.DocumentEditorLock
	err := database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		if _, err := s.editors.GetDocumentForEditor(ctx, tx, tenantID, documentID); err != nil {
			if err == pgx.ErrNoRows {
				return notFoundError("document not found")
			}
			return internalError("load editor document", err)
		}
		if err := s.editors.ExpireDocumentLocks(ctx, tx, tenantID, documentID); err != nil {
			return internalError("expire editor locks", err)
		}
		active, err := s.editors.GetActiveLock(ctx, tx, tenantID, documentID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return notFoundError("active document lock not found")
			}
			return internalError("load editor lock", err)
		}
		if active.LockedBy != userID {
			return forbiddenError("only the lock owner can release this document lock")
		}
		if req.SessionID != nil && (active.SessionID == nil || *active.SessionID != *req.SessionID) {
			return validationError("session_id does not match the active lock", map[string]string{"session_id": "mismatch"})
		}
		lock, err := s.editors.ReleaseActiveLock(ctx, tx, tenantID, documentID, userID, req.SessionID, req.Reason)
		if err != nil {
			return internalError("release editor lock", err)
		}
		if err := s.appendAudit(ctx, tx, tenantID, documentID, req.SessionID, &lock.ID, "editor.lock_released", "", &userID, map[string]any{
			"reason": req.Reason,
		}); err != nil {
			return err
		}
		released = lock
		return nil
	})
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.document.editor_unlocked", tenantID, &userID, map[string]any{
		"id":          released.ID,
		"document_id": documentID,
	}, s.logger)
	return released, nil
}

func (s *DocumentEditorService) SubmitPreflight(ctx context.Context, tenantID, documentID, userID uuid.UUID, req dto.SubmitDocumentEditorPreflightRequest) (*model.DocumentEditorPreflightResult, error) {
	req.Normalize()
	if !validPreflightStatus(req.Status) {
		return nil, validationError("status must be passed, warning, or failed", map[string]string{"status": "invalid"})
	}
	if req.Score != nil && (*req.Score < 0 || *req.Score > 100 || math.IsNaN(*req.Score)) {
		return nil, validationError("score must be between 0 and 100", map[string]string{"score": "invalid"})
	}
	preflight := buildPreflightPayload(req, s.now().UTC())
	var session *model.DocumentEditorSession
	err := database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		if _, err := s.editors.GetDocumentForEditor(ctx, tx, tenantID, documentID); err != nil {
			if err == pgx.ErrNoRows {
				return notFoundError("document not found")
			}
			return internalError("load editor document", err)
		}
		if req.SessionID != nil {
			found, err := s.editors.GetSession(ctx, tx, tenantID, *req.SessionID)
			if err != nil {
				if err == pgx.ErrNoRows {
					return validationError("session_id was not found", map[string]string{"session_id": "not_found"})
				}
				return internalError("load editor session", err)
			}
			if found.DocumentID != documentID {
				return validationError("session_id does not belong to this document", map[string]string{"session_id": "mismatch"})
			}
			updated, err := s.editors.UpdateSessionPreflight(ctx, tx, tenantID, found.ID, preflight)
			if err != nil {
				return internalError("record editor preflight", err)
			}
			session = updated
		}
		if err := s.appendAudit(ctx, tx, tenantID, documentID, req.SessionID, nil, "editor.preflight_recorded", "", &userID, preflight); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &model.DocumentEditorPreflightResult{
		Session:   session,
		Accepted:  req.Status != "failed" || !req.Blocking,
		Preflight: preflight,
	}, nil
}

func (s *DocumentEditorService) RequestSnapshot(ctx context.Context, tenantID, documentID, userID uuid.UUID, req dto.RequestDocumentEditorSnapshotRequest) (*model.DocumentEditorVersionSnapshot, error) {
	req.Normalize()
	var snapshot *model.DocumentEditorVersionSnapshot
	err := database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		document, err := s.editors.GetDocumentForEditor(ctx, tx, tenantID, documentID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return notFoundError("document not found")
			}
			return internalError("load editor document", err)
		}
		if req.CurrentVersion != nil && *req.CurrentVersion > 0 && *req.CurrentVersion != document.CurrentVersion {
			return validationError("current_version does not match the active document version", map[string]string{"current_version": "stale"})
		}
		if req.SessionID != nil {
			session, err := s.editors.GetSession(ctx, tx, tenantID, *req.SessionID)
			if err != nil {
				if err == pgx.ErrNoRows {
					return validationError("session_id was not found", map[string]string{"session_id": "not_found"})
				}
				return internalError("load editor session", err)
			}
			if session.DocumentID != documentID {
				return validationError("session_id does not belong to this document", map[string]string{"session_id": "mismatch"})
			}
		}
		metadata := copyStringAnyMap(req.Metadata)
		if req.Source != "" {
			metadata["source"] = req.Source
		}
		snapshot = &model.DocumentEditorVersionSnapshot{
			ID:            uuid.New(),
			TenantID:      tenantID,
			DocumentID:    documentID,
			SessionID:     req.SessionID,
			Version:       document.CurrentVersion,
			ChangeSummary: normalizeOptionalString(&req.ChangeSummary),
			CreatedBy:     userID,
			CreatedAt:     s.now().UTC(),
			Metadata:      metadata,
		}
		if err := s.appendAudit(ctx, tx, tenantID, documentID, req.SessionID, nil, "editor.version_snapshot_requested", "", &userID, map[string]any{
			"snapshot_id":    snapshot.ID.String(),
			"version":        document.CurrentVersion,
			"change_summary": req.ChangeSummary,
			"source":         req.Source,
			"metadata":       metadata,
		}); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.document.editor_snapshot_requested", tenantID, &userID, map[string]any{
		"id":          snapshot.ID,
		"document_id": documentID,
		"version":     snapshot.Version,
	}, s.logger)
	return snapshot, nil
}

func (s *DocumentEditorService) ListAudit(ctx context.Context, tenantID, documentID uuid.UUID, page, perPage int) ([]model.DocumentEditorAuditEntry, int, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 25
	}
	var items []model.DocumentEditorAuditEntry
	var total int
	err := database.RunReadWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		if _, err := s.editors.GetDocumentForEditor(ctx, tx, tenantID, documentID); err != nil {
			if err == pgx.ErrNoRows {
				return notFoundError("document not found")
			}
			return internalError("load editor document", err)
		}
		found, count, err := s.editors.ListAudit(ctx, tx, tenantID, documentID, perPage, (page-1)*perPage)
		if err != nil {
			return internalError("list editor audit", err)
		}
		items = found
		total = count
		return nil
	})
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (s *DocumentEditorService) NegotiationRoomSummary(ctx context.Context, tenantID, documentID uuid.UUID) (*model.DocumentEditorNegotiationRoomSummary, error) {
	workspace, err := s.loadDocumentEditorWorkspaceRead(ctx, tenantID, documentID)
	if err != nil {
		return nil, err
	}
	return buildNegotiationRoomSummary(workspace), nil
}

func (s *DocumentEditorService) PlaybookEnforcementSummary(ctx context.Context, tenantID, documentID uuid.UUID) (*model.DocumentEditorPlaybookEnforcementSummary, error) {
	workspace, err := s.loadDocumentEditorWorkspaceRead(ctx, tenantID, documentID)
	if err != nil {
		return nil, err
	}
	return buildPlaybookEnforcementSummary(workspace), nil
}

func (s *DocumentEditorService) NavigatorSummary(ctx context.Context, tenantID, documentID uuid.UUID) (*model.DocumentEditorNavigatorSummary, error) {
	workspace, err := s.loadDocumentEditorWorkspaceRead(ctx, tenantID, documentID)
	if err != nil {
		return nil, err
	}
	return buildNavigatorSummary(workspace), nil
}

func (s *DocumentEditorService) SectionAssignmentsSummary(ctx context.Context, tenantID, documentID uuid.UUID) (*model.DocumentEditorSectionAssignmentsSummary, error) {
	workspace, err := s.loadDocumentEditorWorkspaceRead(ctx, tenantID, documentID)
	if err != nil {
		return nil, err
	}
	return buildSectionAssignmentsSummary(workspace), nil
}

func (s *DocumentEditorService) RequestGuestReviewLink(ctx context.Context, tenantID, documentID, userID uuid.UUID, req dto.RequestDocumentEditorGuestReviewLinkRequest) (*model.DocumentEditorGuestReviewLinkRequestResult, error) {
	req.Normalize()
	if req.ReviewerEmail == "" || !strings.Contains(req.ReviewerEmail, "@") || strings.Contains(req.ReviewerEmail, " ") {
		return nil, validationError("reviewer_email must be a valid email address", map[string]string{"reviewer_email": "invalid"})
	}
	if req.AccessMode != model.DocumentEditorModeView && req.AccessMode != model.DocumentEditorModeComment {
		return nil, validationError("access_mode must be view or comment for external review", map[string]string{"access_mode": "invalid"})
	}
	createdAt := s.now().UTC()
	expiresAt := createdAt.Add(guestReviewTTL(req.ExpiresInSeconds))
	requestID := uuid.New()
	result := &model.DocumentEditorGuestReviewLinkRequestResult{
		RequestID:  requestID,
		DocumentID: documentID,
		SessionID:  req.SessionID,
		Reviewer: model.DocumentEditorParticipant{
			Name:         req.ReviewerName,
			Email:        req.ReviewerEmail,
			Role:         "external_reviewer",
			Organization: req.Organization,
			Status:       "requested",
			External:     true,
		},
		AccessMode:  req.AccessMode,
		Sections:    append([]string(nil), req.Sections...),
		ExpiresAt:   &expiresAt,
		Status:      "requested",
		AuditAction: "editor.guest_review_link_requested",
		Metadata:    copyStringAnyMap(req.Metadata),
		CreatedAt:   createdAt,
	}

	err := database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		if _, err := s.editors.GetDocumentForEditor(ctx, tx, tenantID, documentID); err != nil {
			if err == pgx.ErrNoRows {
				return notFoundError("document not found")
			}
			return internalError("load editor document", err)
		}
		if err := s.ensureEditorSessionForDocument(ctx, tx, tenantID, documentID, req.SessionID); err != nil {
			return err
		}
		link := &model.DocumentEditorGuestReviewLink{
			ID:            requestID,
			TenantID:      tenantID,
			DocumentID:    documentID,
			SessionID:     req.SessionID,
			TokenHash:     hashEditorCallbackToken(uuid.NewString()),
			ReviewerName:  req.ReviewerName,
			ReviewerEmail: req.ReviewerEmail,
			Organization:  req.Organization,
			AccessMode:    req.AccessMode,
			Sections:      append([]string(nil), req.Sections...),
			Status:        "requested",
			Message:       req.Message,
			ExpiresAt:     &expiresAt,
			CreatedBy:     userID,
			Metadata:      copyStringAnyMap(req.Metadata),
		}
		if err := s.editors.CreateGuestReviewLink(ctx, tx, link); err != nil {
			return internalError("create editor guest review link", err)
		}
		approval := &model.DocumentEditorApprovalRequest{
			ID:          uuid.New(),
			TenantID:    tenantID,
			DocumentID:  documentID,
			SessionID:   req.SessionID,
			TargetType:  "external_share",
			TargetID:    &requestID,
			Status:      "requested",
			Priority:    "medium",
			Reason:      firstNonEmpty(req.Message, "External guest review requested"),
			RequestedBy: userID,
			DueAt:       &expiresAt,
			Metadata: map[string]any{
				"reviewer_email": req.ReviewerEmail,
				"access_mode":    string(req.AccessMode),
				"sections":       req.Sections,
				"source":         "editor_guest_review_link",
			},
		}
		if err := s.editors.CreateApprovalRequest(ctx, tx, approval); err != nil {
			return internalError("create editor guest review approval request", err)
		}
		return s.appendAudit(ctx, tx, tenantID, documentID, req.SessionID, nil, result.AuditAction, "", &userID, map[string]any{
			"request_id":   requestID.String(),
			"reviewer":     map[string]any{"name": req.ReviewerName, "email": req.ReviewerEmail, "organization": req.Organization},
			"access_mode":  string(req.AccessMode),
			"sections":     req.Sections,
			"message":      req.Message,
			"expires_at":   expiresAt.Format(time.RFC3339),
			"metadata":     req.Metadata,
			"request_type": "external_guest_review_link",
		})
	})
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.document.editor_guest_review_requested", tenantID, &userID, map[string]any{
		"id":          requestID,
		"document_id": documentID,
		"access_mode": req.AccessMode,
	}, s.logger)
	return result, nil
}

func (s *DocumentEditorService) LegalIssuesSummary(ctx context.Context, tenantID, documentID uuid.UUID) (*model.DocumentEditorLegalIssuesSummary, error) {
	workspace, err := s.loadDocumentEditorWorkspaceRead(ctx, tenantID, documentID)
	if err != nil {
		return nil, err
	}
	return buildLegalIssuesSummary(workspace), nil
}

func (s *DocumentEditorService) SignatureReadinessSummary(ctx context.Context, tenantID, documentID uuid.UUID) (*model.DocumentEditorSignatureReadinessSummary, error) {
	workspace, err := s.loadDocumentEditorWorkspaceRead(ctx, tenantID, documentID)
	if err != nil {
		return nil, err
	}
	return buildSignatureReadinessSummary(workspace), nil
}

func (s *DocumentEditorService) RequestClauseAIAction(ctx context.Context, tenantID, documentID, userID uuid.UUID, req dto.RequestDocumentEditorClauseAIActionRequest) (*model.DocumentEditorClauseAIActionRequestResult, error) {
	req.Normalize()
	if !validEditorActionKey(req.Action) {
		return nil, validationError("action is required and must be a stable action key", map[string]string{"action": "invalid"})
	}
	if req.ClauseID == nil && req.ClauseType == "" && req.SectionReference == "" && req.Prompt == "" && len(req.Selection) == 0 {
		return nil, validationError("clause action scope is required", map[string]string{"clause_id": "required_without_selection"})
	}
	createdAt := s.now().UTC()
	requestID := uuid.New()
	result := &model.DocumentEditorClauseAIActionRequestResult{
		RequestID:        requestID,
		DocumentID:       documentID,
		SessionID:        req.SessionID,
		Action:           req.Action,
		ClauseID:         req.ClauseID,
		ClauseType:       req.ClauseType,
		SectionReference: req.SectionReference,
		Status:           "requested",
		AuditAction:      "editor.clause_ai_action_requested",
		Metadata:         copyStringAnyMap(req.Metadata),
		CreatedAt:        createdAt,
	}

	err := database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		document, err := s.editors.GetDocumentForEditor(ctx, tx, tenantID, documentID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return notFoundError("document not found")
			}
			return internalError("load editor document", err)
		}
		if err := s.ensureEditorSessionForDocument(ctx, tx, tenantID, documentID, req.SessionID); err != nil {
			return err
		}
		if req.ClauseID != nil && document.ContractID != nil {
			if err := ensureContractClauseExists(ctx, tx, tenantID, *document.ContractID, *req.ClauseID); err != nil {
				return err
			}
		}
		approval := &model.DocumentEditorApprovalRequest{
			ID:          uuid.New(),
			TenantID:    tenantID,
			DocumentID:  documentID,
			SessionID:   req.SessionID,
			TargetType:  "ai_change",
			TargetID:    &requestID,
			Status:      "requested",
			Priority:    "medium",
			Reason:      firstNonEmpty(req.Prompt, "AI clause action requested"),
			RequestedBy: userID,
			Metadata: map[string]any{
				"action":            req.Action,
				"clause_id":         uuidPtrString(req.ClauseID),
				"clause_type":       req.ClauseType,
				"section_reference": req.SectionReference,
				"source":            "editor_clause_ai_action",
			},
		}
		if err := s.editors.CreateApprovalRequest(ctx, tx, approval); err != nil {
			return internalError("create editor ai change approval request", err)
		}
		return s.appendAudit(ctx, tx, tenantID, documentID, req.SessionID, nil, result.AuditAction, "", &userID, map[string]any{
			"request_id":        requestID.String(),
			"action":            req.Action,
			"clause_id":         uuidPtrString(req.ClauseID),
			"clause_type":       req.ClauseType,
			"section_reference": req.SectionReference,
			"prompt_present":    req.Prompt != "",
			"selection":         req.Selection,
			"metadata":          req.Metadata,
		})
	})
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.document.editor_clause_ai_requested", tenantID, &userID, map[string]any{
		"id":          requestID,
		"document_id": documentID,
		"action":      req.Action,
	}, s.logger)
	return result, nil
}

func (s *DocumentEditorService) HealthScore(ctx context.Context, tenantID, documentID uuid.UUID) (*model.DocumentEditorHealthScore, error) {
	workspace, err := s.loadDocumentEditorWorkspaceRead(ctx, tenantID, documentID)
	if err != nil {
		return nil, err
	}
	return buildDocumentHealthScore(workspace), nil
}

func (s *DocumentEditorService) PrivilegedControlsSummary(ctx context.Context, tenantID, documentID uuid.UUID) (*model.DocumentEditorPrivilegedControlsSummary, error) {
	workspace, err := s.loadDocumentEditorWorkspaceRead(ctx, tenantID, documentID)
	if err != nil {
		return nil, err
	}
	return buildPrivilegedControlsSummary(workspace), nil
}

func (s *DocumentEditorService) WorkspaceCapabilitySummary(ctx context.Context, tenantID, documentID uuid.UUID, capability string) (map[string]any, error) {
	capability = strings.ToLower(strings.TrimSpace(capability))
	workspace, err := s.loadDocumentEditorWorkspaceRead(ctx, tenantID, documentID)
	if err != nil {
		return nil, err
	}
	switch capability {
	case "provider_events":
		return buildEditorProviderEventsSummary(workspace), nil
	case "guest_portal":
		return buildEditorGuestPortalSummary(workspace), nil
	case "task_automation":
		return buildEditorTaskAutomationSummary(workspace), nil
	case "clause_anchors":
		return buildEditorClauseAnchorsSummary(workspace), nil
	case "redline_package":
		return buildEditorRedlinePackageSummary(workspace), nil
	case "approval_matrix":
		return buildEditorApprovalMatrixSummary(workspace), nil
	case "compare_workspace":
		return buildEditorCompareWorkspaceSummary(workspace), nil
	case "collaboration_inbox":
		return buildEditorCollaborationInboxSummary(workspace), nil
	case "playbook_rules":
		return buildEditorPlaybookRulesSummary(workspace), nil
	case "defined_term_repairs":
		return buildEditorDefinedTermRepairsSummary(workspace), nil
	case "citation_evidence":
		return buildEditorCitationEvidenceSummary(workspace), nil
	case "ai_change_safety":
		return buildEditorAIChangeSafetySummary(workspace), nil
	case "offline_recovery":
		return buildEditorOfflineRecoverySummary(workspace), nil
	case "editor_analytics":
		return buildEditorAnalyticsSummary(workspace), nil
	default:
		return nil, validationError("editor capability is not supported", map[string]string{"capability": "unsupported"})
	}
}

func (s *DocumentEditorService) RequestPrivilegedControl(ctx context.Context, tenantID, documentID, userID uuid.UUID, req dto.RequestDocumentEditorPrivilegedControlRequest) (*model.DocumentEditorPrivilegedControlRequestResult, error) {
	req.Normalize()
	if !validEditorActionKey(req.Control) {
		return nil, validationError("control is required and must be a stable control key", map[string]string{"control": "invalid"})
	}
	if req.Reason == "" {
		return nil, validationError("reason is required for privileged control requests", map[string]string{"reason": "required"})
	}
	createdAt := s.now().UTC()
	requestID := uuid.New()
	result := &model.DocumentEditorPrivilegedControlRequestResult{
		RequestID:      requestID,
		DocumentID:     documentID,
		SessionID:      req.SessionID,
		Control:        req.Control,
		RequestedState: req.RequestedState,
		Reason:         req.Reason,
		Status:         "requested",
		AuditAction:    "editor.privileged_control_requested",
		Metadata:       copyStringAnyMap(req.Metadata),
		CreatedAt:      createdAt,
	}

	err := database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		if _, err := s.editors.GetDocumentForEditor(ctx, tx, tenantID, documentID); err != nil {
			if err == pgx.ErrNoRows {
				return notFoundError("document not found")
			}
			return internalError("load editor document", err)
		}
		if err := s.ensureEditorSessionForDocument(ctx, tx, tenantID, documentID, req.SessionID); err != nil {
			return err
		}
		controlRequest := &model.DocumentEditorPrivilegedControlRequest{
			ID:             requestID,
			TenantID:       tenantID,
			DocumentID:     documentID,
			SessionID:      req.SessionID,
			ControlKey:     req.Control,
			RequestedState: req.RequestedState,
			Status:         "requested",
			Reason:         req.Reason,
			RequestedBy:    userID,
			Metadata:       copyStringAnyMap(req.Metadata),
		}
		if err := s.editors.CreatePrivilegedControlRequest(ctx, tx, controlRequest); err != nil {
			return internalError("create editor privileged control request", err)
		}
		approval := &model.DocumentEditorApprovalRequest{
			ID:          uuid.New(),
			TenantID:    tenantID,
			DocumentID:  documentID,
			SessionID:   req.SessionID,
			TargetType:  "privileged_control",
			TargetID:    &requestID,
			Status:      "requested",
			Priority:    "medium",
			Reason:      req.Reason,
			RequestedBy: userID,
			Metadata: map[string]any{
				"control":         req.Control,
				"requested_state": req.RequestedState,
				"source":          "editor_privileged_control_request",
			},
		}
		if err := s.editors.CreateApprovalRequest(ctx, tx, approval); err != nil {
			return internalError("create editor approval request", err)
		}
		return s.appendAudit(ctx, tx, tenantID, documentID, req.SessionID, nil, result.AuditAction, "", &userID, map[string]any{
			"request_id":      requestID.String(),
			"control":         req.Control,
			"requested_state": req.RequestedState,
			"reason":          req.Reason,
			"metadata":        req.Metadata,
		})
	})
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.document.editor_privileged_control_requested", tenantID, &userID, map[string]any{
		"id":          requestID,
		"document_id": documentID,
		"control":     req.Control,
	}, s.logger)
	return result, nil
}

func (s *DocumentEditorService) RecordWorkspaceAction(ctx context.Context, tenantID, documentID, userID uuid.UUID, action string, detail map[string]any) (map[string]any, error) {
	action = strings.ToLower(strings.TrimSpace(action))
	if !validEditorActionKey(action) {
		return nil, validationError("action is required and must be a stable action key", map[string]string{"action": "invalid"})
	}
	if detail == nil {
		detail = map[string]any{}
	}
	var sessionID *uuid.UUID
	if parsed, ok := uuidFromAny(detail["session_id"]); ok {
		sessionID = &parsed
	}
	requestID := uuid.New()
	createdAt := s.now().UTC()
	result := map[string]any{
		"request_id":   requestID,
		"document_id":  documentID,
		"session_id":   sessionID,
		"status":       "requested",
		"audit_action": action,
		"detail":       detail,
		"created_at":   createdAt,
	}
	err := database.RunWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		document, err := s.editors.GetDocumentForEditor(ctx, tx, tenantID, documentID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return notFoundError("document not found")
			}
			return internalError("load editor document", err)
		}
		if err := s.ensureEditorSessionForDocument(ctx, tx, tenantID, documentID, sessionID); err != nil {
			return err
		}
		if err := s.persistWorkspaceAction(ctx, tx, tenantID, document, userID, sessionID, action, requestID, detail); err != nil {
			return err
		}
		auditDetail := copyStringAnyMap(detail)
		auditDetail["request_id"] = requestID.String()
		return s.appendAudit(ctx, tx, tenantID, documentID, sessionID, nil, action, "", &userID, auditDetail)
	})
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.document.editor_workspace_action", tenantID, &userID, map[string]any{
		"id":          requestID,
		"document_id": documentID,
		"action":      action,
	}, s.logger)
	return result, nil
}

func (s *DocumentEditorService) persistWorkspaceAction(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID, document *model.LegalDocument, userID uuid.UUID, sessionID *uuid.UUID, action string, requestID uuid.UUID, detail map[string]any) error {
	switch action {
	case "editor.negotiation_message_added":
		if err := s.persistNegotiationMessage(ctx, tx, tenantID, document.ID, userID, sessionID, detail); err != nil {
			return err
		}
	case "editor.legal_issue_created", "editor.legal_issue_updated":
		status := ""
		if action == "editor.legal_issue_created" {
			status = "open"
		}
		if err := s.persistLegalIssue(ctx, tx, tenantID, document.ID, userID, sessionID, detail, status); err != nil {
			return err
		}
	case "editor.legal_issue_resolved":
		if err := s.resolvePersistedLegalIssue(ctx, tx, tenantID, document.ID, userID, detail); err != nil {
			return err
		}
	case "editor.section_assignments_updated":
		if err := s.persistSectionAssignments(ctx, tx, tenantID, document.ID, userID, sessionID, detail); err != nil {
			return err
		}
	case "editor.guest_review_link_revoked":
		linkRef := stringFromKeys(detail, "link_id", "linkId", "id")
		if linkRef != "" {
			if _, err := s.editors.RevokeGuestReviewLink(ctx, tx, tenantID, document.ID, linkRef, userID, copyStringAnyMap(detail)); err != nil && err != pgx.ErrNoRows {
				return internalError("revoke editor guest review link", err)
			}
		}
	case "editor.privileged_controls_updated":
		if err := s.persistPrivilegedControls(ctx, tx, tenantID, document.ID, userID, detail); err != nil {
			return err
		}
	case "editor.terms_cross_references_requested":
		if err := s.persistClauseAnchorsFromAction(ctx, tx, tenantID, document, userID, sessionID, detail); err != nil {
			return err
		}
	}
	if err := s.persistWorkspaceActionRollup(ctx, tx, tenantID, document.ID, action, requestID, detail); err != nil {
		return err
	}
	return nil
}

func (s *DocumentEditorService) persistNegotiationMessage(ctx context.Context, tx pgx.Tx, tenantID, documentID, userID uuid.UUID, sessionID *uuid.UUID, detail map[string]any) error {
	body := firstNonEmpty(stringFromKeys(detail, "body", "message", "text", "comment"), "Workspace update")
	actorID := userID
	message := &model.DocumentEditorNegotiationMessage{
		ID:               uuidFromDetailOrNew(detail, "id", "message_id", "messageId"),
		TenantID:         tenantID,
		DocumentID:       documentID,
		SessionID:        sessionID,
		ActorUserID:      &actorID,
		ParticipantName:  stringFromKeys(detail, "participant_name", "participantName", "author_name", "authorName"),
		ParticipantEmail: stringFromKeys(detail, "participant_email", "participantEmail", "author_email", "authorEmail"),
		ParticipantRole:  firstNonEmpty(stringFromKeys(detail, "participant_role", "participantRole", "role"), "internal"),
		MessageType:      normalizeEditorChoice(stringFromKeys(detail, "message_type", "messageType", "type"), "message", "message", "note", "position", "system"),
		Visibility:       normalizeEditorChoice(stringFromKeys(detail, "visibility"), "internal", "internal", "external", "shared"),
		Status:           normalizeEditorChoice(stringFromKeys(detail, "status"), "open", "open", "resolved", "archived"),
		Body:             body,
		SectionReference: stringFromKeys(detail, "section_reference", "sectionReference", "section_id", "sectionId"),
		Metadata:         workspaceActionMetadata(detail),
	}
	if issueID, ok := s.resolveIssueRef(ctx, tx, tenantID, documentID, stringFromKeys(detail, "issue_id", "issueId")); ok {
		message.IssueID = &issueID
	}
	if parentID, ok := uuidFromAny(firstAny(detail, "parent_message_id", "parentMessageId")); ok {
		message.ParentMessageID = &parentID
	}
	if err := s.editors.CreateNegotiationMessage(ctx, tx, message); err != nil {
		return internalError("create editor negotiation message", err)
	}
	return nil
}

func (s *DocumentEditorService) persistLegalIssue(ctx context.Context, tx pgx.Tx, tenantID, documentID, userID uuid.UUID, sessionID *uuid.UUID, detail map[string]any, defaultStatus string) error {
	issueRef := stringFromKeys(detail, "issue_id", "issueId", "id", "key")
	issueID := uuidFromDetailOrNew(detail, "issue_id", "issueId", "id")
	var externalID *string
	if issueRef != "" {
		if foundID, ok := s.resolveIssueRef(ctx, tx, tenantID, documentID, issueRef); ok {
			issueID = foundID
		} else if _, parsed := uuidFromAny(issueRef); !parsed {
			externalID = normalizeOptionalString(&issueRef)
		}
	}
	status := firstNonEmpty(defaultStatus, stringFromKeys(detail, "status"))
	issue := &model.DocumentEditorLegalIssueRecord{
		ID:               issueID,
		TenantID:         tenantID,
		DocumentID:       documentID,
		SessionID:        sessionID,
		ExternalID:       externalID,
		Title:            firstNonEmpty(stringFromKeys(detail, "title", "summary", "name"), "Legal issue"),
		Description:      stringFromKeys(detail, "description", "body", "message"),
		Severity:         normalizeEditorChoice(stringFromKeys(detail, "severity", "risk_level", "riskLevel"), "medium", "critical", "high", "medium", "low", "info"),
		Status:           normalizeEditorChoice(status, "open", "open", "in_review", "blocked", "resolved", "waived", "closed"),
		Source:           firstNonEmpty(stringFromKeys(detail, "source"), "manual"),
		SectionReference: stringFromKeys(detail, "section_reference", "sectionReference", "section", "clause_reference", "clauseReference"),
		OwnerName:        stringFromKeys(detail, "owner", "owner_name", "ownerName", "assignee_name", "assigneeName"),
		DueAt:            timePtrFromAny(firstAny(detail, "due_at", "dueAt", "deadline")),
		Metadata:         workspaceActionMetadata(detail),
		CreatedBy:        userID,
		UpdatedBy:        &userID,
	}
	if ownerID, ok := uuidFromAny(firstAny(detail, "owner_user_id", "ownerUserId", "assignee_id", "assigneeId")); ok {
		issue.OwnerUserID = &ownerID
	}
	if anchorID, ok := uuidFromAny(firstAny(detail, "anchor_id", "anchorId")); ok {
		issue.AnchorID = &anchorID
	}
	if err := s.editors.UpsertLegalIssue(ctx, tx, issue); err != nil {
		return internalError("upsert editor legal issue", err)
	}
	return nil
}

func (s *DocumentEditorService) resolvePersistedLegalIssue(ctx context.Context, tx pgx.Tx, tenantID, documentID, userID uuid.UUID, detail map[string]any) error {
	issueRef := stringFromKeys(detail, "issue_id", "issueId", "id", "key")
	if issueRef == "" {
		return s.persistLegalIssue(ctx, tx, tenantID, documentID, userID, nil, detail, "resolved")
	}
	notes := stringFromKeys(detail, "resolution_notes", "resolutionNotes", "notes", "message")
	if _, err := s.editors.ResolveLegalIssue(ctx, tx, tenantID, documentID, issueRef, userID, notes, workspaceActionMetadata(detail)); err != nil {
		if err == pgx.ErrNoRows {
			detail["status"] = "resolved"
			return s.persistLegalIssue(ctx, tx, tenantID, documentID, userID, nil, detail, "resolved")
		}
		return internalError("resolve editor legal issue", err)
	}
	return nil
}

func (s *DocumentEditorService) persistSectionAssignments(ctx context.Context, tx pgx.Tx, tenantID, documentID, userID uuid.UUID, sessionID *uuid.UUID, detail map[string]any) error {
	assignments := sectionAssignmentsFromAny(firstAny(detail, "assignments", "sections", "review_assignments", "reviewAssignments"))
	if len(assignments) == 0 && firstNonEmpty(stringFromKeys(detail, "title", "section_title", "sectionTitle"), stringFromKeys(detail, "section_reference", "sectionReference", "section_id", "sectionId")) != "" {
		assignments = []model.DocumentEditorSectionAssignment{sectionAssignmentFromMap(detail)}
	}
	for _, assignment := range assignments {
		record := &model.DocumentEditorSectionAssignmentRecord{
			ID:               uuidFromStringOrNew(assignment.ID),
			TenantID:         tenantID,
			DocumentID:       documentID,
			SessionID:        sessionID,
			SectionID:        assignment.SectionID,
			Title:            firstNonEmpty(assignment.Title, "Section review"),
			SectionReference: assignment.SectionReference,
			AssigneeID:       assignment.AssigneeID,
			AssigneeName:     assignment.AssigneeName,
			Role:             firstNonEmpty(assignment.Role, "reviewer"),
			Status:           normalizeEditorChoice(assignment.Status, "open", "open", "pending", "in_progress", "blocked", "completed", "waived"),
			DueAt:            assignment.DueAt,
			Metadata:         copyStringAnyMap(assignment.Metadata),
			CreatedBy:        userID,
			UpdatedBy:        &userID,
		}
		if anchorID, ok := uuidFromAny(firstAny(assignment.Metadata, "anchor_id", "anchorId")); ok {
			record.AnchorID = &anchorID
		}
		if err := s.editors.UpsertSectionAssignment(ctx, tx, record); err != nil {
			return internalError("upsert editor section assignment", err)
		}
	}
	return nil
}

func (s *DocumentEditorService) persistPrivilegedControls(ctx context.Context, tx pgx.Tx, tenantID, documentID, userID uuid.UUID, detail map[string]any) error {
	controlMaps := privilegedControlMapsFromDetail(detail)
	for _, raw := range controlMaps {
		key := normalizeEditorControlKey(firstNonEmpty(stringFromKeys(raw, "control_key", "controlKey", "key"), stringFromKeys(raw, "control")))
		if key == "" {
			continue
		}
		control := &model.DocumentEditorPrivilegedControlRecord{
			ID:         uuidFromDetailOrNew(raw, "id"),
			TenantID:   tenantID,
			DocumentID: documentID,
			ControlKey: key,
			Enabled:    boolFromAnyWithDefault(firstAny(raw, "enabled", "value", "requested_state", "requestedState"), false),
			Locked:     boolFromAny(firstAny(raw, "locked")),
			Reason:     stringFromKeys(raw, "reason"),
			Status:     normalizeEditorChoice(stringFromKeys(raw, "status"), "active", "active", "requested", "disabled"),
			Metadata:   workspaceActionMetadata(raw),
			UpdatedBy:  &userID,
		}
		if err := s.editors.UpsertPrivilegedControl(ctx, tx, control); err != nil {
			return internalError("upsert editor privileged control", err)
		}
	}
	return nil
}

func (s *DocumentEditorService) persistClauseAnchorsFromAction(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID, document *model.LegalDocument, userID uuid.UUID, sessionID *uuid.UUID, detail map[string]any) error {
	rawAnchors := mapsFromAny(firstAny(detail, "anchors", "clause_anchors", "clauseAnchors"))
	for _, raw := range rawAnchors {
		anchorKey := firstNonEmpty(stringFromKeys(raw, "anchor_key", "anchorKey", "key"), stringFromKeys(raw, "section_reference", "sectionReference", "section_id", "sectionId"))
		if anchorKey == "" {
			continue
		}
		anchor := &model.DocumentEditorClauseAnchor{
			ID:               uuidFromDetailOrNew(raw, "id", "anchor_id", "anchorId"),
			TenantID:         tenantID,
			DocumentID:       document.ID,
			SessionID:        sessionID,
			DocumentVersion:  intFromAnyDefault(firstAny(raw, "document_version", "documentVersion", "version"), document.CurrentVersion),
			AnchorKey:        anchorKey,
			SectionID:        stringFromKeys(raw, "section_id", "sectionId"),
			SectionReference: stringFromKeys(raw, "section_reference", "sectionReference", "section"),
			Title:            stringFromKeys(raw, "title", "name"),
			ClauseType:       stringFromKeys(raw, "clause_type", "clauseType"),
			StartOffset:      intPtrFromAny(firstAny(raw, "start_offset", "startOffset")),
			EndOffset:        intPtrFromAny(firstAny(raw, "end_offset", "endOffset")),
			PageNumber:       intPtrFromAny(firstAny(raw, "page_number", "pageNumber", "page")),
			DocXPath:         stringFromKeys(raw, "docx_path", "docxPath"),
			Checksum:         stringFromKeys(raw, "checksum", "hash"),
			ExtractedText:    stringFromKeys(raw, "extracted_text", "extractedText", "text"),
			Confidence:       floatFromAnyDefault(firstAny(raw, "confidence"), 1),
			Status:           normalizeEditorChoice(stringFromKeys(raw, "status"), "active", "active", "stale", "superseded", "deleted"),
			Metadata:         workspaceActionMetadata(raw),
			CreatedBy:        userID,
			UpdatedBy:        &userID,
		}
		if clauseID, ok := uuidFromAny(firstAny(raw, "clause_id", "clauseId")); ok {
			anchor.ClauseID = &clauseID
		}
		if err := s.editors.UpsertClauseAnchor(ctx, tx, anchor); err != nil {
			return internalError("upsert editor clause anchor", err)
		}
	}
	return nil
}

func (s *DocumentEditorService) persistWorkspaceActionRollup(ctx context.Context, tx pgx.Tx, tenantID, documentID uuid.UUID, action string, requestID uuid.UUID, detail map[string]any) error {
	now := s.now().UTC()
	rollup := &model.DocumentEditorAnalyticsRollup{
		ID:           uuid.New(),
		TenantID:     tenantID,
		DocumentID:   &documentID,
		Grain:        "document",
		PeriodStart:  normalizeDate(now),
		PeriodEnd:    normalizeDate(now),
		MetricKey:    "editor_workspace_action",
		MetricValue:  1,
		Dimensions:   map[string]any{"action": action},
		Metadata:     map[string]any{"request_id": requestID.String(), "detail_keys": mapKeys(detail)},
		CalculatedAt: now,
	}
	if err := s.editors.InsertAnalyticsRollup(ctx, tx, rollup); err != nil {
		return internalError("record editor analytics rollup", err)
	}
	return nil
}

func (s *DocumentEditorService) resolveCallbackSession(ctx context.Context, tx pgx.Tx, tenantID, documentID uuid.UUID, provider string, payload map[string]any) (*model.DocumentEditorSession, error) {
	if sessionID, ok := uuidFromAny(payload["session_id"]); ok {
		session, err := s.editors.GetSession(ctx, tx, tenantID, sessionID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return nil, validationError("session_id was not found", map[string]string{"session_id": "not_found"})
			}
			return nil, internalError("load editor session", err)
		}
		if session.DocumentID != documentID {
			return nil, validationError("session_id does not belong to this document", map[string]string{"session_id": "mismatch"})
		}
		return session, nil
	}
	providerKey := strings.TrimSpace(stringFromAny(payload["key"]))
	if providerKey == "" {
		return nil, validationError("callback key or session_id is required", map[string]string{"key": "required"})
	}
	session, err := s.editors.GetLatestActiveSessionByProviderKey(ctx, tx, tenantID, provider, providerKey)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, validationError("editor session was not found for callback key", map[string]string{"key": "not_found"})
		}
		return nil, internalError("load editor session by callback key", err)
	}
	if session.DocumentID != documentID {
		return nil, validationError("callback key does not belong to this document", map[string]string{"key": "mismatch"})
	}
	return session, nil
}

func (s *DocumentEditorService) appendAudit(ctx context.Context, q repository.Queryer, tenantID, documentID uuid.UUID, sessionID, lockID *uuid.UUID, action, provider string, actorID *uuid.UUID, detail map[string]any) error {
	provider = strings.TrimSpace(provider)
	entry := &model.DocumentEditorAuditEntry{
		ID:          uuid.New(),
		TenantID:    tenantID,
		DocumentID:  documentID,
		SessionID:   sessionID,
		LockID:      lockID,
		Action:      action,
		Provider:    normalizeOptionalString(&provider),
		ActorUserID: actorID,
		Detail:      detail,
	}
	if err := s.editors.AppendAudit(ctx, q, entry); err != nil {
		return internalError("append editor audit", err)
	}
	return nil
}

type documentEditorWorkspaceContext struct {
	document            *model.LegalDocument
	workspaceMetadata   map[string]any
	activeLock          *model.DocumentEditorLock
	activeSessions      int
	totalSessions       int
	lastActivityAt      *time.Time
	latestSessionID     *uuid.UUID
	latestPreflight     map[string]any
	latestCallback      map[string]any
	latestSnapshot      map[string]any
	audit               []model.DocumentEditorAuditEntry
	auditTotal          int
	contractAnalysis    map[string]any
	contractClauses     []map[string]any
	signatureEnvelope   map[string]any
	signatureRecipients []map[string]any
	guestLinks          []model.DocumentEditorGuestReviewLink
	negotiationMessages []model.DocumentEditorNegotiationMessage
	legalIssues         []model.DocumentEditorLegalIssue
	sectionAssignments  []model.DocumentEditorSectionAssignment
	privilegedControls  []model.DocumentEditorPrivilegedControlRecord
	clauseAnchors       []model.DocumentEditorClauseAnchor
	approvalRequests    []model.DocumentEditorApprovalRequest
	citationBindings    []model.DocumentEditorCitationBinding
	editorTasks         []model.DocumentEditorTask
	generatedAt         time.Time
}

func (s *DocumentEditorService) loadDocumentEditorWorkspaceRead(ctx context.Context, tenantID, documentID uuid.UUID) (*documentEditorWorkspaceContext, error) {
	var workspace *documentEditorWorkspaceContext
	err := database.RunReadWithTenant(ctx, s.db, tenantID, func(tx pgx.Tx) error {
		found, err := s.loadDocumentEditorWorkspace(ctx, tx, tenantID, documentID)
		if err != nil {
			return err
		}
		workspace = found
		return nil
	})
	if err != nil {
		return nil, err
	}
	return workspace, nil
}

func (s *DocumentEditorService) loadDocumentEditorWorkspace(ctx context.Context, tx pgx.Tx, tenantID, documentID uuid.UUID) (*documentEditorWorkspaceContext, error) {
	document, err := s.editors.GetDocumentForEditor(ctx, tx, tenantID, documentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("document not found")
		}
		return nil, internalError("load editor document", err)
	}
	generatedAt := s.now().UTC()
	workspace := &documentEditorWorkspaceContext{
		document:            document,
		workspaceMetadata:   documentEditorWorkspaceMetadata(document.Metadata),
		latestPreflight:     map[string]any{},
		latestCallback:      map[string]any{},
		latestSnapshot:      map[string]any{},
		contractAnalysis:    map[string]any{},
		contractClauses:     []map[string]any{},
		signatureEnvelope:   map[string]any{},
		signatureRecipients: []map[string]any{},
		generatedAt:         generatedAt,
	}

	activeLock, err := s.editors.GetActiveLock(ctx, tx, tenantID, documentID)
	if err != nil && err != pgx.ErrNoRows {
		return nil, internalError("load editor lock", err)
	}
	if err == nil && (activeLock.ExpiresAt == nil || activeLock.ExpiresAt.After(generatedAt)) {
		workspace.activeLock = activeLock
	}
	if err := loadEditorSessionSnapshot(ctx, tx, tenantID, documentID, workspace); err != nil {
		return nil, err
	}
	audit, total, err := loadRecentEditorAudit(ctx, tx, tenantID, documentID, 25)
	if err != nil {
		return nil, err
	}
	workspace.audit = audit
	workspace.auditTotal = total
	if err := s.loadPersistedEditorWorkspace(ctx, tx, tenantID, documentID, workspace); err != nil {
		return nil, err
	}
	if document.ContractID != nil {
		if err := loadEditorContractContext(ctx, tx, tenantID, *document.ContractID, workspace); err != nil {
			return nil, err
		}
	}
	if err := loadEditorSignatureContext(ctx, tx, tenantID, document, workspace); err != nil {
		return nil, err
	}
	return workspace, nil
}

func (s *DocumentEditorService) loadPersistedEditorWorkspace(ctx context.Context, q repository.Queryer, tenantID, documentID uuid.UUID, workspace *documentEditorWorkspaceContext) error {
	guestLinks, err := s.editors.ListGuestReviewLinks(ctx, q, tenantID, documentID, 50)
	if err != nil {
		return internalError("load editor guest links", err)
	}
	workspace.guestLinks = guestLinks

	messages, err := s.editors.ListNegotiationMessages(ctx, q, tenantID, documentID, 50)
	if err != nil {
		return internalError("load editor negotiation messages", err)
	}
	workspace.negotiationMessages = messages

	issueRecords, err := s.editors.ListLegalIssues(ctx, q, tenantID, documentID, 100)
	if err != nil {
		return internalError("load editor legal issues", err)
	}
	workspace.legalIssues = make([]model.DocumentEditorLegalIssue, 0, len(issueRecords))
	for _, issue := range issueRecords {
		workspace.legalIssues = append(workspace.legalIssues, documentEditorLegalIssueFromRecord(issue))
	}

	assignmentRecords, err := s.editors.ListSectionAssignments(ctx, q, tenantID, documentID, 100)
	if err != nil {
		return internalError("load editor section assignments", err)
	}
	workspace.sectionAssignments = make([]model.DocumentEditorSectionAssignment, 0, len(assignmentRecords))
	for _, assignment := range assignmentRecords {
		workspace.sectionAssignments = append(workspace.sectionAssignments, documentEditorSectionAssignmentFromRecord(assignment))
	}

	controls, err := s.editors.ListPrivilegedControls(ctx, q, tenantID, documentID)
	if err != nil {
		return internalError("load editor privileged controls", err)
	}
	workspace.privilegedControls = controls

	anchors, err := s.editors.ListClauseAnchors(ctx, q, tenantID, documentID, 200)
	if err != nil {
		return internalError("load editor clause anchors", err)
	}
	workspace.clauseAnchors = anchors

	approvals, err := s.editors.ListApprovalRequests(ctx, q, tenantID, documentID, 100)
	if err != nil {
		return internalError("load editor approval requests", err)
	}
	workspace.approvalRequests = approvals

	citations, err := s.editors.ListCitationBindings(ctx, q, tenantID, documentID, 100)
	if err != nil {
		return internalError("load editor citation bindings", err)
	}
	workspace.citationBindings = citations

	tasks, err := s.editors.ListEditorTasks(ctx, q, tenantID, documentID, 100)
	if err != nil {
		return internalError("load editor tasks", err)
	}
	workspace.editorTasks = tasks
	return nil
}

func loadEditorSessionSnapshot(ctx context.Context, q repository.Queryer, tenantID, documentID uuid.UUID, workspace *documentEditorWorkspaceContext) error {
	stats, err := queryJSONMap(ctx, q, `
		SELECT jsonb_build_object(
			'total_sessions', COUNT(*),
			'active_sessions', COUNT(*) FILTER (WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())),
			'last_activity_at', MAX(updated_at)
		)
		FROM lex_document_editor_sessions
		WHERE tenant_id = $1 AND document_id = $2`,
		tenantID, documentID,
	)
	if err != nil {
		return internalError("load editor session stats", err)
	}
	workspace.totalSessions = intFromAnyDefault(stats["total_sessions"], 0)
	workspace.activeSessions = intFromAnyDefault(stats["active_sessions"], 0)
	workspace.lastActivityAt = timePtrFromAny(stats["last_activity_at"])

	latest, err := queryOptionalJSONMap(ctx, q, `
		SELECT row_to_json(t)
		FROM (
			SELECT id, COALESCE(preflight_result, '{}'::jsonb) AS preflight_result,
			       COALESCE(last_callback, '{}'::jsonb) AS last_callback,
			       COALESCE(snapshot_metadata, '{}'::jsonb) AS snapshot_metadata,
			       updated_at
			FROM lex_document_editor_sessions
			WHERE tenant_id = $1 AND document_id = $2
			ORDER BY updated_at DESC
			LIMIT 1
		) t`,
		tenantID, documentID,
	)
	if err != nil {
		return internalError("load latest editor session", err)
	}
	if len(latest) > 0 {
		if id, ok := uuidFromAny(latest["id"]); ok {
			workspace.latestSessionID = &id
		}
		workspace.latestPreflight = mapOrEmpty(latest["preflight_result"])
		workspace.latestCallback = mapOrEmpty(latest["last_callback"])
		workspace.latestSnapshot = mapOrEmpty(latest["snapshot_metadata"])
		if workspace.lastActivityAt == nil {
			workspace.lastActivityAt = timePtrFromAny(latest["updated_at"])
		}
	}
	return nil
}

func loadRecentEditorAudit(ctx context.Context, q repository.Queryer, tenantID, documentID uuid.UUID, limit int) ([]model.DocumentEditorAuditEntry, int, error) {
	total := 0
	if err := q.QueryRow(ctx, `SELECT COUNT(*) FROM lex_document_editor_audit WHERE tenant_id = $1 AND document_id = $2`, tenantID, documentID).Scan(&total); err != nil {
		return nil, 0, internalError("count editor audit", err)
	}
	rows, err := q.Query(ctx, `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, document_id, session_id, lock_id, action, provider,
			       actor_user_id, COALESCE(detail, '{}'::jsonb) AS detail, created_at
			FROM lex_document_editor_audit
			WHERE tenant_id = $1 AND document_id = $2
			ORDER BY created_at DESC
			LIMIT $3
		) t`,
		tenantID, documentID, limit,
	)
	if err != nil {
		return nil, 0, internalError("load editor audit", err)
	}
	defer rows.Close()
	items := []model.DocumentEditorAuditEntry{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, 0, internalError("scan editor audit", err)
		}
		var item model.DocumentEditorAuditEntry
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, 0, internalError("decode editor audit", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, internalError("iterate editor audit", err)
	}
	return items, total, nil
}

func loadEditorContractContext(ctx context.Context, q repository.Queryer, tenantID, contractID uuid.UUID, workspace *documentEditorWorkspaceContext) error {
	analysis, err := queryOptionalJSONMap(ctx, q, `
		SELECT row_to_json(t)
		FROM (
			SELECT overall_risk, risk_score::float8 AS risk_score, clause_count,
			       high_risk_clause_count, missing_clauses, key_findings,
			       recommendations, compliance_flags, analyzed_at
			FROM contract_analyses
			WHERE tenant_id = $1 AND contract_id = $2
			ORDER BY analyzed_at DESC
			LIMIT 1
		) t`,
		tenantID, contractID,
	)
	if err != nil {
		return internalError("load contract analysis for editor", err)
	}
	workspace.contractAnalysis = analysis

	clauses, err := queryJSONMapSlice(ctx, q, `
		SELECT COALESCE(jsonb_agg(jsonb_build_object(
			'id', id,
			'clause_type', clause_type,
			'title', title,
			'section_reference', section_reference,
			'risk_level', risk_level,
			'risk_score', risk_score::float8,
			'review_status', review_status,
			'analysis_summary', analysis_summary,
			'recommendations', recommendations,
			'compliance_flags', compliance_flags
		)), '[]'::jsonb)
		FROM (
			SELECT id, clause_type, title, section_reference, risk_level, risk_score,
			       review_status, analysis_summary, recommendations, compliance_flags, created_at
			FROM contract_clauses
			WHERE tenant_id = $1 AND contract_id = $2
			ORDER BY risk_score DESC, created_at ASC
			LIMIT 100
		) c`,
		tenantID, contractID,
	)
	if err != nil {
		return internalError("load contract clauses for editor", err)
	}
	workspace.contractClauses = clauses
	return nil
}

func loadEditorSignatureContext(ctx context.Context, q repository.Queryer, tenantID uuid.UUID, document *model.LegalDocument, workspace *documentEditorWorkspaceContext) error {
	var contractID any
	if document.ContractID != nil {
		contractID = *document.ContractID
	}
	envelope, err := queryOptionalJSONMap(ctx, q, `
		SELECT row_to_json(t)
		FROM (
			SELECT id, status, provider, method, due_at, expires_at, updated_at
			FROM signature_envelopes
			WHERE tenant_id = $1
			  AND deleted_at IS NULL
			  AND (
				(target_type = 'document' AND document_id = $2)
				OR (target_type = 'contract' AND contract_id = $3)
			  )
			ORDER BY updated_at DESC
			LIMIT 1
		) t`,
		tenantID, document.ID, contractID,
	)
	if err != nil {
		return internalError("load signature envelope for editor", err)
	}
	workspace.signatureEnvelope = envelope
	envelopeID, ok := uuidFromAny(envelope["id"])
	if !ok {
		return nil
	}
	recipients, err := queryJSONMapSlice(ctx, q, `
		SELECT COALESCE(jsonb_agg(jsonb_build_object(
			'id', id,
			'user_id', user_id,
			'name', name,
			'email', email,
			'role', role,
			'status', status,
			'signed_at', signed_at
		) ORDER BY signing_order, created_at), '[]'::jsonb)
		FROM signature_recipients
		WHERE tenant_id = $1 AND envelope_id = $2`,
		tenantID, envelopeID,
	)
	if err != nil {
		return internalError("load signature recipients for editor", err)
	}
	workspace.signatureRecipients = recipients
	return nil
}

func (s *DocumentEditorService) ensureEditorSessionForDocument(ctx context.Context, q repository.Queryer, tenantID, documentID uuid.UUID, sessionID *uuid.UUID) error {
	if sessionID == nil {
		return nil
	}
	session, err := s.editors.GetSession(ctx, q, tenantID, *sessionID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return validationError("session_id was not found", map[string]string{"session_id": "not_found"})
		}
		return internalError("load editor session", err)
	}
	if session.DocumentID != documentID {
		return validationError("session_id does not belong to this document", map[string]string{"session_id": "mismatch"})
	}
	return nil
}

func ensureContractClauseExists(ctx context.Context, q repository.Queryer, tenantID, contractID, clauseID uuid.UUID) error {
	var exists bool
	if err := q.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM contract_clauses
			WHERE tenant_id = $1 AND contract_id = $2 AND id = $3
		)`,
		tenantID, contractID, clauseID,
	).Scan(&exists); err != nil {
		return internalError("validate clause action scope", err)
	}
	if !exists {
		return validationError("clause_id was not found for the linked contract", map[string]string{"clause_id": "not_found"})
	}
	return nil
}

func buildNegotiationRoomSummary(workspace *documentEditorWorkspaceContext) *model.DocumentEditorNegotiationRoomSummary {
	section := workspaceSection(workspace.workspaceMetadata, "negotiation_room", "negotiationRoom", "negotiation")
	participants := participantsFromAny(firstAny(section, "participants", "counterparties", "reviewers"))
	if len(workspace.guestLinks) > 0 {
		for _, link := range workspace.guestLinks {
			participants = append(participants, model.DocumentEditorParticipant{
				Name:         link.ReviewerName,
				Email:        link.ReviewerEmail,
				Role:         "external_reviewer",
				Organization: link.Organization,
				Status:       link.Status,
				External:     true,
				Metadata:     copyStringAnyMap(link.Metadata),
			})
		}
	}
	pending := workspaceItemsFromAny(firstAny(section, "pending_items", "pendingItems", "open_items", "openItems"), "negotiation_room")
	if len(pending) == 0 {
		for _, issue := range legalIssuesFromWorkspace(workspace) {
			if !closedStatus(issue.Status) {
				pending = append(pending, model.DocumentEditorWorkspaceItem{
					Key:              issue.ID,
					Title:            issue.Title,
					Status:           issue.Status,
					Severity:         issue.Severity,
					SectionReference: issue.SectionReference,
					Owner:            issue.Owner,
					Source:           issue.Source,
				})
			}
			if len(pending) >= 5 {
				break
			}
		}
	}
	status := stringFromKeys(section, "status")
	if status == "" {
		if workspace.activeLock != nil || workspace.activeSessions > 0 {
			status = "active"
		} else if len(workspace.negotiationMessages) > 0 || len(workspace.guestLinks) > 0 {
			status = "in_review"
		} else {
			status = "idle"
		}
	}
	return &model.DocumentEditorNegotiationRoomSummary{
		Document:       editorDocumentSummary(workspace.document),
		Status:         status,
		Phase:          stringFromKeys(section, "phase", "stage"),
		Summary:        stringFromKeys(section, "summary"),
		NextStep:       stringFromKeys(section, "next_step", "nextStep"),
		Participants:   participants,
		PendingItems:   pending,
		ActiveLock:     workspace.activeLock,
		ActiveSessions: workspace.activeSessions,
		RecentActivity: timelineEventsFromAudit(workspace.audit, 8),
		Metadata:       copyStringAnyMap(section),
		GeneratedAt:    workspace.generatedAt,
	}
}

func buildPlaybookEnforcementSummary(workspace *documentEditorWorkspaceContext) *model.DocumentEditorPlaybookEnforcementSummary {
	section := workspaceSection(workspace.workspaceMetadata, "playbook_enforcement", "playbookEnforcement", "playbook")
	required := workspaceItemsFromAny(firstAny(section, "required_clauses", "requiredClauses"), "playbook")
	matched := workspaceItemsFromAny(firstAny(section, "matched_clauses", "matchedClauses"), "playbook")
	missing := workspaceItemsFromAny(firstAny(section, "missing_clauses", "missingClauses"), "playbook")
	deviations := workspaceItemsFromAny(firstAny(section, "deviations", "clause_deviations", "clauseDeviations"), "playbook")
	if len(missing) == 0 {
		for _, clauseType := range stringSliceFromAny(workspace.contractAnalysis["missing_clauses"]) {
			missing = append(missing, model.DocumentEditorWorkspaceItem{
				Key:      clauseType,
				Title:    clauseType,
				Status:   "missing",
				Severity: "high",
				Source:   "contract_analysis",
			})
		}
	}
	clauseCount := intFromAnyDefault(firstAny(section, "clause_count", "clauseCount"), 0)
	if clauseCount == 0 {
		clauseCount = intFromAnyDefault(workspace.contractAnalysis["clause_count"], len(workspace.contractClauses))
	}
	highRiskClauseCount := intFromAnyDefault(firstAny(section, "high_risk_clause_count", "highRiskClauseCount"), 0)
	if highRiskClauseCount == 0 {
		highRiskClauseCount = intFromAnyDefault(workspace.contractAnalysis["high_risk_clause_count"], countHighRiskClauses(workspace.contractClauses))
	}
	status := stringFromKeys(section, "status")
	if status == "" {
		switch {
		case len(missing) > 0 || len(deviations) > 0:
			status = "attention_required"
		case clauseCount > 0:
			status = "passed"
		default:
			status = "not_evaluated"
		}
	}
	return &model.DocumentEditorPlaybookEnforcementSummary{
		Document:            editorDocumentSummary(workspace.document),
		ContractID:          workspace.document.ContractID,
		Status:              status,
		PlaybookID:          stringFromKeys(section, "playbook_id", "playbookId"),
		PlaybookName:        stringFromKeys(section, "playbook_name", "playbookName", "name"),
		ClauseCount:         clauseCount,
		HighRiskClauseCount: highRiskClauseCount,
		RequiredClauses:     required,
		MatchedClauses:      matched,
		MissingClauses:      missing,
		Deviations:          deviations,
		Metadata:            copyStringAnyMap(section),
		GeneratedAt:         workspace.generatedAt,
	}
}

func buildNavigatorSummary(workspace *documentEditorWorkspaceContext) *model.DocumentEditorNavigatorSummary {
	section := workspaceSection(workspace.workspaceMetadata, "navigator", "defined_terms", "definedTerms", "cross_references", "crossReferences")
	terms := definedTermsFromAny(firstAny(section, "defined_terms", "definedTerms", "terms"))
	if len(terms) == 0 && len(workspace.clauseAnchors) > 0 {
		for _, anchor := range workspace.clauseAnchors {
			if strings.TrimSpace(anchor.Title) == "" {
				continue
			}
			terms = append(terms, model.DocumentEditorDefinedTerm{
				Term:             anchor.Title,
				SectionReference: anchor.SectionReference,
				Occurrences:      1,
				Metadata:         copyStringAnyMap(anchor.Metadata),
			})
		}
	}
	if len(terms) == 0 && workspace.document.ExtractedText != nil {
		terms = extractDefinedTermsFromText(*workspace.document.ExtractedText)
	}
	references := crossReferencesFromAny(firstAny(section, "cross_references", "crossReferences", "references"))
	if len(references) == 0 && workspace.document.ExtractedText != nil {
		references = extractCrossReferencesFromText(*workspace.document.ExtractedText)
	}
	broken := 0
	for _, ref := range references {
		if ref.Status == "broken" || ref.Status == "missing" {
			broken++
		}
	}
	return &model.DocumentEditorNavigatorSummary{
		Document:             editorDocumentSummary(workspace.document),
		DefinedTerms:         terms,
		CrossReferences:      references,
		BrokenReferenceCount: broken,
		Metadata:             copyStringAnyMap(section),
		GeneratedAt:          workspace.generatedAt,
	}
}

func buildSectionAssignmentsSummary(workspace *documentEditorWorkspaceContext) *model.DocumentEditorSectionAssignmentsSummary {
	section := workspaceSection(workspace.workspaceMetadata, "section_assignments", "sectionAssignments", "assignments")
	assignments := append([]model.DocumentEditorSectionAssignment(nil), workspace.sectionAssignments...)
	if len(assignments) == 0 {
		assignments = sectionAssignmentsFromAny(firstAny(section, "assignments", "sections", "review_assignments", "reviewAssignments"))
	}
	if len(assignments) == 0 {
		for _, clause := range workspace.contractClauses {
			status := stringFromKeys(clause, "review_status", "reviewStatus")
			if status == "" || closedStatus(status) {
				continue
			}
			assignments = append(assignments, model.DocumentEditorSectionAssignment{
				ID:               stringFromKeys(clause, "id"),
				SectionReference: stringFromKeys(clause, "section_reference", "sectionReference"),
				Title:            firstNonEmpty(stringFromKeys(clause, "title"), stringFromKeys(clause, "clause_type", "clauseType"), "Clause review"),
				Status:           status,
				Role:             "reviewer",
				Metadata:         copyStringAnyMap(clause),
			})
		}
	}
	openCount, completedCount, overdueCount := 0, 0, 0
	for _, assignment := range assignments {
		if closedStatus(assignment.Status) {
			completedCount++
		} else {
			openCount++
		}
		if assignment.DueAt != nil && assignment.DueAt.Before(workspace.generatedAt) && !closedStatus(assignment.Status) {
			overdueCount++
		}
	}
	return &model.DocumentEditorSectionAssignmentsSummary{
		Document:       editorDocumentSummary(workspace.document),
		Assignments:    assignments,
		OpenCount:      openCount,
		CompletedCount: completedCount,
		OverdueCount:   overdueCount,
		Metadata:       copyStringAnyMap(section),
		GeneratedAt:    workspace.generatedAt,
	}
}

func buildLegalIssuesSummary(workspace *documentEditorWorkspaceContext) *model.DocumentEditorLegalIssuesSummary {
	section := workspaceSection(workspace.workspaceMetadata, "legal_issues", "legalIssues", "issues")
	issues := legalIssuesFromWorkspace(workspace)
	openCount, highSeverityCount := 0, 0
	for _, issue := range issues {
		if !closedStatus(issue.Status) {
			openCount++
		}
		if highSeverity(issue.Severity) {
			highSeverityCount++
		}
	}
	return &model.DocumentEditorLegalIssuesSummary{
		Document:          editorDocumentSummary(workspace.document),
		Issues:            issues,
		OpenCount:         openCount,
		HighSeverityCount: highSeverityCount,
		Metadata:          copyStringAnyMap(section),
		GeneratedAt:       workspace.generatedAt,
	}
}

func buildSignatureReadinessSummary(workspace *documentEditorWorkspaceContext) *model.DocumentEditorSignatureReadinessSummary {
	section := workspaceSection(workspace.workspaceMetadata, "signature_readiness", "signatureReadiness", "signature")
	signers := signatureSignersFromAny(firstAny(section, "signers", "recipients"))
	if len(signers) == 0 {
		signers = signatureSignersFromRecipients(workspace.signatureRecipients)
	}
	blockers := workspaceItemsFromAny(firstAny(section, "blockers", "blocking_items", "blockingItems"), "signature")
	if workspace.document.FileID == nil {
		blockers = append(blockers, model.DocumentEditorWorkspaceItem{Key: "document_file", Title: "Document file is required before signature", Status: "blocked", Severity: "high", Source: "document"})
	}
	if len(signers) == 0 {
		blockers = append(blockers, model.DocumentEditorWorkspaceItem{Key: "signers", Title: "At least one signer is required", Status: "blocked", Severity: "high", Source: "signature"})
	}
	envelopeID, _ := uuidFromAny(workspace.signatureEnvelope["id"])
	var envelopeIDPtr *uuid.UUID
	if envelopeID != uuid.Nil {
		envelopeIDPtr = &envelopeID
	}
	signedCount := 0
	for _, signer := range signers {
		if signer.Status == "signed" {
			signedCount++
		}
	}
	envelopeStatus := stringFromKeys(workspace.signatureEnvelope, "status")
	ready := boolFromAny(firstAny(section, "ready", "is_ready", "isReady"))
	if _, ok := section["ready"]; !ok {
		_, snakeOK := section["is_ready"]
		_, camelOK := section["isReady"]
		if !snakeOK && !camelOK {
			ready = len(blockers) == 0
		}
	}
	status := stringFromKeys(section, "status")
	if status == "" {
		if envelopeStatus == "signed" {
			status = "completed"
			ready = true
		} else if ready {
			status = "ready"
		} else {
			status = "blocked"
		}
	}
	return &model.DocumentEditorSignatureReadinessSummary{
		Document:       editorDocumentSummary(workspace.document),
		Ready:          ready,
		Status:         status,
		EnvelopeID:     envelopeIDPtr,
		EnvelopeStatus: envelopeStatus,
		Provider:       stringFromKeys(workspace.signatureEnvelope, "provider"),
		Method:         stringFromKeys(workspace.signatureEnvelope, "method"),
		SignerCount:    len(signers),
		SignedCount:    signedCount,
		Signers:        signers,
		Blockers:       blockers,
		Metadata:       copyStringAnyMap(section),
		GeneratedAt:    workspace.generatedAt,
	}
}

func buildDocumentHealthScore(workspace *documentEditorWorkspaceContext) *model.DocumentEditorHealthScore {
	section := workspaceSection(workspace.workspaceMetadata, "health", "document_health", "documentHealth")
	checks := healthChecksFromAny(firstAny(section, "checks"))
	signature := buildSignatureReadinessSummary(workspace)
	playbook := buildPlaybookEnforcementSummary(workspace)
	issues := buildLegalIssuesSummary(workspace)
	score, hasScore := floatFromAny(firstAny(section, "score", "health_score", "healthScore"))
	if !hasScore {
		score = 100
		addCheck := func(key, status, severity, message string, impact float64) {
			checks = append(checks, model.DocumentEditorHealthCheck{Key: key, Status: status, Severity: severity, Message: message, ScoreImpact: impact})
			score += impact
		}
		if workspace.document.FileID == nil {
			addCheck("document_file", "warning", "medium", "No managed document file is attached", -15)
		} else {
			addCheck("document_file", "passed", "info", "Managed document file is attached", 0)
		}
		preflightStatus := stringFromKeys(workspace.latestPreflight, "status")
		switch preflightStatus {
		case "failed":
			addCheck("preflight", "failed", "high", "Latest editor preflight failed", -30)
		case "warning":
			addCheck("preflight", "warning", "medium", "Latest editor preflight has warnings", -10)
		case "passed":
			addCheck("preflight", "passed", "info", "Latest editor preflight passed", 0)
		default:
			addCheck("preflight", "unknown", "low", "No editor preflight has been recorded", -5)
		}
		if len(playbook.MissingClauses)+len(playbook.Deviations) > 0 {
			addCheck("playbook", "warning", "high", "Playbook gaps or deviations require review", -float64(editorMinInt(25, (len(playbook.MissingClauses)+len(playbook.Deviations))*5)))
		} else if playbook.Status == "passed" {
			addCheck("playbook", "passed", "info", "Playbook enforcement has no open gaps", 0)
		}
		if issues.HighSeverityCount > 0 {
			addCheck("legal_issues", "warning", "high", "High severity legal issues are open", -float64(editorMinInt(30, issues.HighSeverityCount*10)))
		} else if issues.OpenCount > 0 {
			addCheck("legal_issues", "warning", "medium", "Legal issues remain open", -float64(editorMinInt(20, issues.OpenCount*4)))
		} else {
			addCheck("legal_issues", "passed", "info", "No open legal issues were detected", 0)
		}
		if len(signature.Blockers) > 0 {
			addCheck("signature", "warning", "medium", "Signature readiness has blockers", -float64(editorMinInt(15, len(signature.Blockers)*5)))
		}
	}
	score = roundEditorScore(clampScore(score))
	status := stringFromKeys(section, "status")
	if status == "" {
		status = healthStatus(score)
	}
	signals := []model.DocumentEditorWorkspaceItem{}
	signals = append(signals, playbook.MissingClauses...)
	signals = append(signals, playbook.Deviations...)
	for _, issue := range issues.Issues {
		if !closedStatus(issue.Status) {
			signals = append(signals, model.DocumentEditorWorkspaceItem{Key: issue.ID, Title: issue.Title, Status: issue.Status, Severity: issue.Severity, SectionReference: issue.SectionReference, Source: issue.Source})
		}
	}
	return &model.DocumentEditorHealthScore{
		Document:    editorDocumentSummary(workspace.document),
		Score:       score,
		Status:      status,
		Checks:      checks,
		Signals:     limitWorkspaceItems(signals, 20),
		Metadata:    copyStringAnyMap(section),
		GeneratedAt: workspace.generatedAt,
	}
}

func buildPrivilegedControlsSummary(workspace *documentEditorWorkspaceContext) *model.DocumentEditorPrivilegedControlsSummary {
	section := workspaceSection(workspace.workspaceMetadata, "privileged_controls", "privilegedControls", "privilege")
	privileged := workspace.document.Confidentiality == model.DocumentConfidentialityPrivileged || boolFromAny(firstAny(section, "privileged", "is_privileged", "isPrivileged"))
	sensitive := privileged || workspace.document.Confidentiality == model.DocumentConfidentialityConfidential
	externalSharingAllowed := boolFromAnyWithDefault(firstAny(section, "external_sharing_allowed", "externalSharingAllowed"), !sensitive)
	downloadAllowed := boolFromAnyWithDefault(firstAny(section, "download_allowed", "downloadAllowed"), !privileged)
	printAllowed := boolFromAnyWithDefault(firstAny(section, "print_allowed", "printAllowed"), !privileged)
	copyAllowed := boolFromAnyWithDefault(firstAny(section, "copy_allowed", "copyAllowed"), !privileged)
	watermarkRequired := boolFromAnyWithDefault(firstAny(section, "watermark_required", "watermarkRequired"), sensitive)
	approvalRequired := boolFromAnyWithDefault(firstAny(section, "approval_required", "approvalRequired"), sensitive)
	controlByKey := map[string]model.DocumentEditorPrivilegedControlRecord{}
	for _, control := range workspace.privilegedControls {
		key := strings.ToLower(strings.TrimSpace(control.ControlKey))
		if key == "" {
			continue
		}
		controlByKey[key] = control
		switch key {
		case "external_sharing":
			externalSharingAllowed = control.Enabled
		case "download":
			downloadAllowed = control.Enabled
		case "print":
			printAllowed = control.Enabled
		case "copy":
			copyAllowed = control.Enabled
		case "watermark":
			watermarkRequired = control.Enabled
		case "approval_required":
			approvalRequired = control.Enabled
		}
	}
	controls := []model.DocumentEditorPrivilegedControl{
		{Key: "external_sharing", Label: "External sharing", Enabled: externalSharingAllowed, Locked: privileged, Reason: controlReason(privileged, "privileged document")},
		{Key: "download", Label: "Download", Enabled: downloadAllowed, Locked: privileged, Reason: controlReason(privileged, "privileged document")},
		{Key: "print", Label: "Print", Enabled: printAllowed, Locked: privileged, Reason: controlReason(privileged, "privileged document")},
		{Key: "copy", Label: "Copy", Enabled: copyAllowed, Locked: privileged, Reason: controlReason(privileged, "privileged document")},
		{Key: "watermark", Label: "Watermark", Enabled: watermarkRequired, Locked: false},
		{Key: "approval_required", Label: "Approval required", Enabled: approvalRequired, Locked: false},
	}
	for idx := range controls {
		if persisted, ok := controlByKey[controls[idx].Key]; ok {
			controls[idx].Enabled = persisted.Enabled
			controls[idx].Locked = persisted.Locked
			controls[idx].Reason = firstNonEmpty(persisted.Reason, controls[idx].Reason)
		}
	}
	return &model.DocumentEditorPrivilegedControlsSummary{
		Document:               editorDocumentSummary(workspace.document),
		Confidentiality:        workspace.document.Confidentiality,
		Privileged:             privileged,
		ExternalSharingAllowed: externalSharingAllowed,
		DownloadAllowed:        downloadAllowed,
		PrintAllowed:           printAllowed,
		CopyAllowed:            copyAllowed,
		WatermarkRequired:      watermarkRequired,
		ApprovalRequired:       approvalRequired,
		Controls:               controls,
		Holds:                  workspaceItemsFromAny(firstAny(section, "holds", "legal_holds", "legalHolds"), "privileged_controls"),
		Metadata:               copyStringAnyMap(section),
		GeneratedAt:            workspace.generatedAt,
	}
}

func buildEditorProviderEventsSummary(workspace *documentEditorWorkspaceContext) map[string]any {
	events := auditEventsMatching(workspace, "editor.provider_event", 20)
	provider := firstNonEmpty(stringFromKeys(workspace.latestCallback, "provider"), stringFromKeys(workspace.latestSnapshot, "provider"), "onlyoffice")
	status := "not_configured"
	if len(workspace.latestCallback) > 0 || len(events) > 0 {
		status = "receiving"
	}
	return map[string]any{
		"document":         editorDocumentSummary(workspace.document),
		"document_id":      workspace.document.ID,
		"provider":         provider,
		"status":           status,
		"last_callback":    workspace.latestCallback,
		"recent_events":    events,
		"supported_events": []string{"save", "coauthor_join", "coauthor_leave", "comment_created", "track_change_accepted", "export_started", "error"},
		"generated_at":     workspace.generatedAt,
	}
}

func buildEditorGuestPortalSummary(workspace *documentEditorWorkspaceContext) map[string]any {
	privilege := buildPrivilegedControlsSummary(workspace)
	events := auditEventsMatching(workspace, "editor.guest_review", 20)
	status := "available"
	if privilege.Privileged && !privilege.ExternalSharingAllowed {
		status = "approval_required"
	}
	return map[string]any{
		"document":                 editorDocumentSummary(workspace.document),
		"document_id":              workspace.document.ID,
		"status":                   status,
		"watermark_required":       privilege.WatermarkRequired,
		"external_sharing_allowed": privilege.ExternalSharingAllowed,
		"allowed_modes":            []string{string(model.DocumentEditorModeView), string(model.DocumentEditorModeComment)},
		"token_policy": map[string]any{
			"expiry_required":      true,
			"revocation_enforced":  true,
			"default_ttl_seconds":  int(defaultGuestReviewTTL.Seconds()),
			"maximum_ttl_seconds":  int(maxGuestReviewTTL.Seconds()),
			"raw_tokens_returned":  false,
			"raw_tokens_persisted": false,
		},
		"links":        events,
		"generated_at": workspace.generatedAt,
	}
}

func buildEditorTaskAutomationSummary(workspace *documentEditorWorkspaceContext) map[string]any {
	issues := buildLegalIssuesSummary(workspace)
	playbook := buildPlaybookEnforcementSummary(workspace)
	signature := buildSignatureReadinessSummary(workspace)
	candidates := []map[string]any{}
	for _, issue := range issues.Issues {
		if closedStatus(issue.Status) {
			continue
		}
		candidates = append(candidates, map[string]any{
			"id":                 firstNonEmpty(issue.ID, editorStableKey("issue", issue.Title, issue.SectionReference)),
			"title":              issue.Title,
			"source":             firstNonEmpty(issue.Source, "legal_issue"),
			"severity":           firstNonEmpty(issue.Severity, "medium"),
			"status":             "candidate",
			"owner":              issue.Owner,
			"section_reference":  issue.SectionReference,
			"recommended_action": "create_review_task",
			"metadata":           issue.Metadata,
		})
	}
	for _, item := range append(playbook.MissingClauses, playbook.Deviations...) {
		candidates = appendWorkspaceCandidate(candidates, item, "playbook", "route_for_playbook_review")
	}
	for _, item := range signature.Blockers {
		candidates = appendWorkspaceCandidate(candidates, item, "signature", "create_signature_blocker_task")
	}
	return map[string]any{
		"document":         editorDocumentSummary(workspace.document),
		"document_id":      workspace.document.ID,
		"automation_state": "ready",
		"candidate_count":  len(candidates),
		"open_issues":      issues.OpenCount,
		"high_severity":    issues.HighSeverityCount,
		"candidates":       limitMapItems(candidates, 50),
		"sla_tracking": map[string]any{
			"enabled": false,
			"reason":  "task persistence integration pending",
		},
		"recent_actions": auditEventsMatching(workspace, "editor.task_", 10),
		"generated_at":   workspace.generatedAt,
	}
}

func buildEditorClauseAnchorsSummary(workspace *documentEditorWorkspaceContext) map[string]any {
	section := workspaceSection(workspace.workspaceMetadata, "clause_anchors", "clauseAnchors", "anchors")
	anchors := mapSliceFromAny(firstAny(section, "anchors", "clauses", "items"))
	if len(anchors) == 0 {
		for _, clause := range workspace.contractClauses {
			anchors = append(anchors, map[string]any{
				"id":                firstNonEmpty(stringFromKeys(clause, "id"), editorStableKey("clause", stringFromKeys(clause, "clause_type", "clauseType"), stringFromKeys(clause, "section_reference", "sectionReference"))),
				"clause_type":       stringFromKeys(clause, "clause_type", "clauseType"),
				"title":             stringFromKeys(clause, "title"),
				"section_reference": stringFromKeys(clause, "section_reference", "sectionReference"),
				"status":            "detected",
				"source":            "contract_clause",
				"metadata":          copyStringAnyMap(clause),
			})
		}
	}
	return map[string]any{
		"document":             editorDocumentSummary(workspace.document),
		"document_id":          workspace.document.ID,
		"anchors":              anchors,
		"anchor_count":         len(anchors),
		"supported_targets":    []string{"comment", "legal_issue", "playbook_deviation", "approval", "ai_change", "citation"},
		"recent_anchor_events": auditEventsMatching(workspace, "editor.clause_anchor", 10),
		"generated_at":         workspace.generatedAt,
	}
}

func buildEditorRedlinePackageSummary(workspace *documentEditorWorkspaceContext) map[string]any {
	issues := buildLegalIssuesSummary(workspace)
	playbook := buildPlaybookEnforcementSummary(workspace)
	privilege := buildPrivilegedControlsSummary(workspace)
	blockers := []map[string]any{}
	if workspace.document.FileID == nil {
		blockers = append(blockers, map[string]any{"key": "document_file", "message": "A managed document file is required before packaging", "severity": "high"})
	}
	if privilege.Privileged && !privilege.DownloadAllowed {
		blockers = append(blockers, map[string]any{"key": "privileged_download", "message": "Download/export requires privileged document approval", "severity": "high"})
	}
	status := "ready_to_generate"
	if len(blockers) > 0 {
		status = "blocked"
	}
	return map[string]any{
		"document":    editorDocumentSummary(workspace.document),
		"document_id": workspace.document.ID,
		"status":      status,
		"components": []map[string]any{
			{"key": "clean_docx", "label": "Clean DOCX", "available": workspace.document.FileID != nil},
			{"key": "redline_docx", "label": "Redline DOCX", "available": workspace.document.CurrentVersion > 1},
			{"key": "comparison_pdf", "label": "Comparison PDF", "available": workspace.document.CurrentVersion > 1},
			{"key": "issue_list", "label": "Issue list", "available": issues.OpenCount > 0},
			{"key": "deviation_report", "label": "Deviation report", "available": len(playbook.MissingClauses)+len(playbook.Deviations) > 0},
			{"key": "approval_evidence", "label": "Approval evidence", "available": len(auditEventsMatching(workspace, "editor.approval_", 1)) > 0},
			{"key": "audit_trail", "label": "Audit trail", "available": workspace.auditTotal > 0},
		},
		"blockers":        blockers,
		"recent_packages": auditEventsMatching(workspace, "editor.redline_package", 10),
		"generated_at":    workspace.generatedAt,
	}
}

func buildEditorApprovalMatrixSummary(workspace *documentEditorWorkspaceContext) map[string]any {
	issues := buildLegalIssuesSummary(workspace)
	playbook := buildPlaybookEnforcementSummary(workspace)
	signature := buildSignatureReadinessSummary(workspace)
	privilege := buildPrivilegedControlsSummary(workspace)
	requirements := []map[string]any{}
	if privilege.Privileged || privilege.ApprovalRequired {
		requirements = append(requirements, editorApprovalRequirement("privileged_document", "Privileged document controls require approval", "high"))
	}
	if issues.HighSeverityCount > 0 {
		requirements = append(requirements, editorApprovalRequirement("high_severity_issues", "High severity legal issues require owner approval", "high"))
	}
	if len(playbook.MissingClauses)+len(playbook.Deviations) > 0 {
		requirements = append(requirements, editorApprovalRequirement("playbook_deviation", "Open playbook gaps require legal approval", "medium"))
	}
	if len(signature.Blockers) > 0 {
		requirements = append(requirements, editorApprovalRequirement("signature_blockers", "Signature blockers require resolution before final approval", "medium"))
	}
	decision := "clear"
	if len(requirements) > 0 {
		decision = "approval_required"
	}
	return map[string]any{
		"document":               editorDocumentSummary(workspace.document),
		"document_id":            workspace.document.ID,
		"decision":               decision,
		"approval_required":      len(requirements) > 0,
		"required_approvals":     requirements,
		"supported_triggers":     []string{"privileged_edit", "external_sharing", "ai_change_insert", "signature_ready", "final_publish", "high_risk_deviation"},
		"recent_approval_events": auditEventsMatching(workspace, "editor.approval_", 15),
		"generated_at":           workspace.generatedAt,
	}
}

func buildEditorCompareWorkspaceSummary(workspace *documentEditorWorkspaceContext) map[string]any {
	section := workspaceSection(workspace.workspaceMetadata, "compare_workspace", "compareWorkspace", "compare")
	sources := mapSliceFromAny(firstAny(section, "sources", "documents", "versions"))
	if len(sources) == 0 {
		sources = append(sources, map[string]any{
			"id":      workspace.document.ID,
			"label":   "Current document",
			"version": workspace.document.CurrentVersion,
			"type":    "current",
		})
		if workspace.document.CurrentVersion > 1 {
			sources = append(sources, map[string]any{
				"id":      editorStableKey("document", workspace.document.ID.String(), "previous"),
				"label":   "Previous version",
				"version": workspace.document.CurrentVersion - 1,
				"type":    "version",
			})
		}
	}
	return map[string]any{
		"document":        editorDocumentSummary(workspace.document),
		"document_id":     workspace.document.ID,
		"status":          firstNonEmpty(stringFromKeys(section, "status"), "ready"),
		"sources":         sources,
		"comparisons":     mapSliceFromAny(firstAny(section, "comparisons", "runs")),
		"recent_activity": auditEventsMatching(workspace, "editor.compare_", 10),
		"generated_at":    workspace.generatedAt,
	}
}

func buildEditorCollaborationInboxSummary(workspace *documentEditorWorkspaceContext) map[string]any {
	issues := buildLegalIssuesSummary(workspace)
	assignments := buildSectionAssignmentsSummary(workspace)
	items := []map[string]any{}
	for _, issue := range issues.Issues {
		if closedStatus(issue.Status) {
			continue
		}
		items = append(items, map[string]any{
			"id":                firstNonEmpty(issue.ID, editorStableKey("issue", issue.Title)),
			"type":              "legal_issue",
			"title":             issue.Title,
			"severity":          issue.Severity,
			"status":            issue.Status,
			"section_reference": issue.SectionReference,
			"owner":             issue.Owner,
			"created_at":        workspace.generatedAt,
		})
	}
	for _, assignment := range assignments.Assignments {
		if closedStatus(assignment.Status) {
			continue
		}
		items = append(items, map[string]any{
			"id":                firstNonEmpty(assignment.ID, editorStableKey("assignment", assignment.Title, assignment.SectionReference)),
			"type":              "section_assignment",
			"title":             assignment.Title,
			"status":            assignment.Status,
			"section_reference": assignment.SectionReference,
			"owner":             assignment.AssigneeName,
			"due_at":            assignment.DueAt,
			"created_at":        workspace.generatedAt,
		})
	}
	for _, event := range auditEventsMatching(workspace, "editor.", 10) {
		items = append(items, map[string]any{
			"id":         event["id"],
			"type":       "editor_activity",
			"title":      event["action"],
			"status":     "unread",
			"created_at": event["created_at"],
			"metadata":   event["detail"],
		})
	}
	return map[string]any{
		"document":       editorDocumentSummary(workspace.document),
		"document_id":    workspace.document.ID,
		"unread_count":   len(items),
		"mention_count":  countAuditActionsContaining(workspace, "mention"),
		"approval_count": countAuditActionsContaining(workspace, "approval"),
		"items":          limitMapItems(items, 50),
		"generated_at":   workspace.generatedAt,
	}
}

func buildEditorPlaybookRulesSummary(workspace *documentEditorWorkspaceContext) map[string]any {
	section := workspaceSection(workspace.workspaceMetadata, "playbook_rules", "playbookRules", "rule_builder")
	rules := mapSliceFromAny(firstAny(section, "rules", "items"))
	if len(rules) == 0 {
		playbook := buildPlaybookEnforcementSummary(workspace)
		for _, item := range append(playbook.RequiredClauses, playbook.MissingClauses...) {
			rules = append(rules, map[string]any{
				"id":           firstNonEmpty(item.Key, editorStableKey("rule", item.Title)),
				"title":        firstNonEmpty(item.Title, item.Key),
				"rule_type":    "required_clause",
				"severity":     firstNonEmpty(item.Severity, "medium"),
				"status":       firstNonEmpty(item.Status, "draft"),
				"fallback":     item.Owner,
				"metadata":     item.Metadata,
				"source":       item.Source,
				"generated":    true,
				"approval_key": "playbook_deviation",
			})
		}
	}
	return map[string]any{
		"document":        editorDocumentSummary(workspace.document),
		"document_id":     workspace.document.ID,
		"rules":           rules,
		"rule_count":      len(rules),
		"recent_activity": auditEventsMatching(workspace, "editor.playbook_rule", 10),
		"generated_at":    workspace.generatedAt,
	}
}

func buildEditorDefinedTermRepairsSummary(workspace *documentEditorWorkspaceContext) map[string]any {
	navigator := buildNavigatorSummary(workspace)
	actions := []map[string]any{}
	seen := map[string]int{}
	for _, term := range navigator.DefinedTerms {
		key := strings.ToLower(term.Term)
		seen[key]++
		if term.Definition == "" {
			actions = append(actions, map[string]any{
				"id":                 editorStableKey("term", term.Term, "define"),
				"action":             "define_term",
				"term":               term.Term,
				"status":             "suggested",
				"section_reference":  term.SectionReference,
				"occurrences":        term.Occurrences,
				"recommended_action": "add_definition",
			})
		}
	}
	for _, term := range navigator.DefinedTerms {
		if seen[strings.ToLower(term.Term)] > 1 {
			actions = append(actions, map[string]any{
				"id":                 editorStableKey("term", term.Term, "deduplicate"),
				"action":             "deduplicate_term",
				"term":               term.Term,
				"status":             "suggested",
				"recommended_action": "merge_duplicate_definitions",
			})
		}
	}
	for _, ref := range navigator.CrossReferences {
		if ref.Status == "broken" || ref.Status == "missing" {
			actions = append(actions, map[string]any{
				"id":                 editorStableKey("reference", ref.Reference, "repair"),
				"action":             "repair_cross_reference",
				"reference":          ref.Reference,
				"target":             ref.Target,
				"section_reference":  ref.SectionReference,
				"status":             "suggested",
				"recommended_action": "select_valid_target",
			})
		}
	}
	return map[string]any{
		"document":           editorDocumentSummary(workspace.document),
		"document_id":        workspace.document.ID,
		"repair_actions":     actions,
		"repair_count":       len(actions),
		"defined_terms":      navigator.DefinedTerms,
		"cross_references":   navigator.CrossReferences,
		"recent_repair_runs": auditEventsMatching(workspace, "editor.defined_term_repair", 10),
		"generated_at":       workspace.generatedAt,
	}
}

func buildEditorCitationEvidenceSummary(workspace *documentEditorWorkspaceContext) map[string]any {
	section := workspaceSection(workspace.workspaceMetadata, "citation_evidence", "citationEvidence", "citations", "evidence")
	bindings := mapSliceFromAny(firstAny(section, "bindings", "citations", "items"))
	if len(bindings) == 0 && workspace.document.ContractID != nil {
		bindings = append(bindings, map[string]any{
			"id":          editorStableKey("contract", workspace.document.ContractID.String()),
			"source_type": "contract",
			"source_id":   workspace.document.ContractID.String(),
			"title":       "Linked contract",
			"status":      "linked",
		})
	}
	return map[string]any{
		"document":        editorDocumentSummary(workspace.document),
		"document_id":     workspace.document.ID,
		"bindings":        bindings,
		"binding_count":   len(bindings),
		"supported_types": []string{"document", "contract", "policy", "regulation", "case", "matter", "evidence"},
		"recent_activity": auditEventsMatching(workspace, "editor.citation_", 10),
		"generated_at":    workspace.generatedAt,
	}
}

func buildEditorAIChangeSafetySummary(workspace *documentEditorWorkspaceContext) map[string]any {
	privilege := buildPrivilegedControlsSummary(workspace)
	health := buildDocumentHealthScore(workspace)
	gates := []map[string]any{
		{"key": "preview_required", "status": "required", "message": "AI changes must be previewed before insertion"},
		{"key": "redline_required", "status": "required", "message": "AI changes must be inserted as redlines"},
		{"key": "audit_required", "status": "required", "message": "AI changes must be audited"},
	}
	if privilege.ApprovalRequired {
		gates = append(gates, map[string]any{"key": "approval_required", "status": "required", "message": "Privileged or sensitive documents require approval before AI insertion"})
	}
	if health.Score < 70 {
		gates = append(gates, map[string]any{"key": "health_review", "status": "warning", "message": "Document health score is low; legal review is recommended"})
	}
	return map[string]any{
		"document":        editorDocumentSummary(workspace.document),
		"document_id":     workspace.document.ID,
		"mode":            "suggest_only",
		"insert_allowed":  false,
		"human_approval":  true,
		"gates":           gates,
		"recent_activity": auditEventsMatching(workspace, "editor.ai_change_", 10),
		"generated_at":    workspace.generatedAt,
	}
}

func buildEditorOfflineRecoverySummary(workspace *documentEditorWorkspaceContext) map[string]any {
	section := workspaceSection(workspace.workspaceMetadata, "offline_recovery", "offlineRecovery", "recovery")
	recoveries := mapSliceFromAny(firstAny(section, "recoveries", "drafts", "items"))
	status := "ready"
	if workspace.activeSessions == 0 {
		status = "idle"
	}
	return map[string]any{
		"document":             editorDocumentSummary(workspace.document),
		"document_id":          workspace.document.ID,
		"status":               status,
		"pending_recoveries":   recoveries,
		"pending_count":        len(recoveries),
		"last_server_callback": workspace.latestCallback,
		"recent_activity":      auditEventsMatching(workspace, "editor.offline_recovery", 10),
		"generated_at":         workspace.generatedAt,
	}
}

func buildEditorAnalyticsSummary(workspace *documentEditorWorkspaceContext) map[string]any {
	issues := buildLegalIssuesSummary(workspace)
	playbook := buildPlaybookEnforcementSummary(workspace)
	signature := buildSignatureReadinessSummary(workspace)
	health := buildDocumentHealthScore(workspace)
	cycleHours := workspace.generatedAt.Sub(workspace.document.CreatedAt).Hours()
	if cycleHours < 0 {
		cycleHours = 0
	}
	return map[string]any{
		"document":                  editorDocumentSummary(workspace.document),
		"document_id":               workspace.document.ID,
		"health_score":              health.Score,
		"session_count":             workspace.totalSessions,
		"active_sessions":           workspace.activeSessions,
		"audit_event_count":         workspace.auditTotal,
		"open_issue_count":          issues.OpenCount,
		"high_severity_issue_count": issues.HighSeverityCount,
		"playbook_gap_count":        len(playbook.MissingClauses) + len(playbook.Deviations),
		"signature_blocker_count":   len(signature.Blockers),
		"external_review_events":    len(auditEventsMatching(workspace, "editor.guest_review", 100)),
		"approval_events":           countAuditActionsContaining(workspace, "approval"),
		"cycle_time_hours":          roundEditorScore(cycleHours),
		"last_activity_at":          workspace.lastActivityAt,
		"generated_at":              workspace.generatedAt,
	}
}

func appendWorkspaceCandidate(candidates []map[string]any, item model.DocumentEditorWorkspaceItem, source, action string) []map[string]any {
	return append(candidates, map[string]any{
		"id":                 firstNonEmpty(item.Key, editorStableKey(source, item.Title, item.SectionReference)),
		"title":              item.Title,
		"source":             firstNonEmpty(item.Source, source),
		"severity":           firstNonEmpty(item.Severity, "medium"),
		"status":             "candidate",
		"owner":              item.Owner,
		"section_reference":  item.SectionReference,
		"due_at":             item.DueAt,
		"recommended_action": action,
		"metadata":           item.Metadata,
	})
}

func editorApprovalRequirement(key, title, severity string) map[string]any {
	return map[string]any{
		"key":      key,
		"title":    title,
		"severity": severity,
		"status":   "required",
	}
}

func auditEventsMatching(workspace *documentEditorWorkspaceContext, actionPrefix string, limit int) []map[string]any {
	if workspace == nil || limit == 0 {
		return nil
	}
	events := []map[string]any{}
	for _, entry := range workspace.audit {
		if actionPrefix != "" && !strings.HasPrefix(entry.Action, actionPrefix) {
			continue
		}
		events = append(events, map[string]any{
			"id":            entry.ID,
			"document_id":   entry.DocumentID,
			"session_id":    entry.SessionID,
			"action":        entry.Action,
			"provider":      entry.Provider,
			"actor_user_id": entry.ActorUserID,
			"detail":        entry.Detail,
			"created_at":    entry.CreatedAt,
		})
		if limit > 0 && len(events) >= limit {
			break
		}
	}
	return events
}

func countAuditActionsContaining(workspace *documentEditorWorkspaceContext, needle string) int {
	if workspace == nil {
		return 0
	}
	needle = strings.ToLower(strings.TrimSpace(needle))
	if needle == "" {
		return 0
	}
	count := 0
	for _, entry := range workspace.audit {
		if strings.Contains(strings.ToLower(entry.Action), needle) {
			count++
		}
	}
	return count
}

func mapSliceFromAny(value any) []map[string]any {
	switch v := value.(type) {
	case []map[string]any:
		out := make([]map[string]any, 0, len(v))
		for _, item := range v {
			out = append(out, copyStringAnyMap(item))
		}
		return out
	case []any:
		out := make([]map[string]any, 0, len(v))
		for _, item := range v {
			if mapped := mapFromAny(item); len(mapped) > 0 {
				out = append(out, mapped)
			}
		}
		return out
	case map[string]any:
		if items := mapSliceFromAny(firstAny(v, "items", "rows", "values")); len(items) > 0 {
			return items
		}
		return []map[string]any{copyStringAnyMap(v)}
	default:
		return nil
	}
}

func limitMapItems(items []map[string]any, limit int) []map[string]any {
	if limit <= 0 || len(items) <= limit {
		return items
	}
	return items[:limit]
}

func editorStableKey(parts ...string) string {
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

func queryJSONMap(ctx context.Context, q repository.Queryer, query string, args ...any) (map[string]any, error) {
	var raw []byte
	if err := q.QueryRow(ctx, query, args...).Scan(&raw); err != nil {
		return nil, err
	}
	return decodeJSONMapBytes(raw)
}

func queryOptionalJSONMap(ctx context.Context, q repository.Queryer, query string, args ...any) (map[string]any, error) {
	result, err := queryJSONMap(ctx, q, query, args...)
	if err != nil {
		if err == pgx.ErrNoRows {
			return map[string]any{}, nil
		}
		return nil, err
	}
	return result, nil
}

func queryJSONMapSlice(ctx context.Context, q repository.Queryer, query string, args ...any) ([]map[string]any, error) {
	var raw []byte
	if err := q.QueryRow(ctx, query, args...).Scan(&raw); err != nil {
		return nil, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return []map[string]any{}, nil
	}
	var values []map[string]any
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, err
	}
	if values == nil {
		values = []map[string]any{}
	}
	return values, nil
}

func decodeJSONMapBytes(raw []byte) (map[string]any, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]any{}, nil
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	if result == nil {
		result = map[string]any{}
	}
	return result, nil
}

func documentEditorWorkspaceMetadata(metadata map[string]any) map[string]any {
	root := copyStringAnyMap(metadata)
	for _, key := range []string{"editor_workspace", "editorWorkspace", "legal_workspace", "legalWorkspace", "word_editor", "wordEditor"} {
		if section := mapFromAny(root[key]); len(section) > 0 {
			return section
		}
	}
	return root
}

func workspaceSection(root map[string]any, keys ...string) map[string]any {
	if root == nil {
		return map[string]any{}
	}
	for _, key := range keys {
		if section := mapFromAny(root[key]); len(section) > 0 {
			return section
		}
	}
	return copyStringAnyMap(root)
}

func (s *DocumentEditorService) resolveIssueRef(ctx context.Context, q repository.Queryer, tenantID, documentID uuid.UUID, issueRef string) (uuid.UUID, bool) {
	issueRef = strings.TrimSpace(issueRef)
	if issueRef == "" {
		return uuid.Nil, false
	}
	id, err := s.editors.FindLegalIssueID(ctx, q, tenantID, documentID, issueRef)
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

func uuidFromDetailOrNew(values map[string]any, keys ...string) uuid.UUID {
	for _, key := range keys {
		if id, ok := uuidFromAny(values[key]); ok {
			return id
		}
	}
	return uuid.New()
}

func uuidFromStringOrNew(value string) uuid.UUID {
	if id, ok := uuidFromAny(value); ok {
		return id
	}
	return uuid.New()
}

func intPtrFromAny(value any) *int {
	switch v := value.(type) {
	case nil:
		return nil
	default:
		parsed := intFromAnyDefault(v, 0)
		if parsed == 0 {
			return nil
		}
		return &parsed
	}
}

func floatFromAnyDefault(value any, fallback float64) float64 {
	parsed, ok := floatFromAny(value)
	if !ok {
		return fallback
	}
	return parsed
}

func workspaceActionMetadata(values map[string]any) map[string]any {
	if metadata := mapFromAny(values["metadata"]); metadata != nil {
		return metadata
	}
	return copyStringAnyMap(values)
}

func mapsFromAny(value any) []map[string]any {
	switch v := value.(type) {
	case []map[string]any:
		return append([]map[string]any(nil), v...)
	case []any:
		out := make([]map[string]any, 0, len(v))
		for _, item := range v {
			if mapped := mapFromAny(item); mapped != nil {
				out = append(out, mapped)
			}
		}
		return out
	case map[string]any:
		return []map[string]any{v}
	default:
		return nil
	}
}

func privilegedControlMapsFromDetail(detail map[string]any) []map[string]any {
	if controls := mapsFromAny(firstAny(detail, "controls", "items")); len(controls) > 0 {
		return controls
	}
	if key := normalizeEditorControlKey(firstNonEmpty(stringFromKeys(detail, "control_key", "controlKey", "control", "key"), stringFromKeys(detail, "type"))); key != "" {
		control := copyStringAnyMap(detail)
		control["control_key"] = key
		return []map[string]any{control}
	}
	controlKeys := map[string]string{
		"external_sharing_allowed": "external_sharing",
		"externalSharingAllowed":   "external_sharing",
		"download_allowed":         "download",
		"downloadAllowed":          "download",
		"print_allowed":            "print",
		"printAllowed":             "print",
		"copy_allowed":             "copy",
		"copyAllowed":              "copy",
		"watermark_required":       "watermark",
		"watermarkRequired":        "watermark",
		"approval_required":        "approval_required",
		"approvalRequired":         "approval_required",
	}
	out := []map[string]any{}
	for payloadKey, controlKey := range controlKeys {
		if value, ok := detail[payloadKey]; ok {
			out = append(out, map[string]any{
				"control_key": controlKey,
				"enabled":     value,
				"reason":      stringFromKeys(detail, "reason"),
				"metadata":    workspaceActionMetadata(detail),
			})
		}
	}
	return out
}

func normalizeEditorControlKey(value string) string {
	key := strings.ToLower(strings.TrimSpace(value))
	key = strings.ReplaceAll(key, "-", "_")
	key = strings.ReplaceAll(key, " ", "_")
	switch key {
	case "externalsharing", "external_share", "external_sharing_allowed":
		return "external_sharing"
	case "downloads", "download_allowed":
		return "download"
	case "prints", "print_allowed":
		return "print"
	case "copies", "copy_allowed":
		return "copy"
	case "watermark_required":
		return "watermark"
	case "approval", "approvals", "approvalrequired":
		return "approval_required"
	default:
		return key
	}
}

func normalizeEditorChoice(value, fallback string, allowed ...string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return fallback
	}
	for _, candidate := range allowed {
		if normalized == candidate {
			return normalized
		}
	}
	return fallback
}

func mapKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}

func firstAny(values map[string]any, keys ...string) any {
	if values == nil {
		return nil
	}
	for _, key := range keys {
		if value, ok := values[key]; ok {
			return value
		}
	}
	return nil
}

func stringFromKeys(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := stringFromAny(values[key]); value != "" {
			return value
		}
	}
	return ""
}

func mapOrEmpty(value any) map[string]any {
	if mapped := mapFromAny(value); mapped != nil {
		return mapped
	}
	return map[string]any{}
}

func timePtrFromAny(value any) *time.Time {
	switch v := value.(type) {
	case time.Time:
		return &v
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return nil
		}
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02"} {
			parsed, err := time.Parse(layout, trimmed)
			if err == nil {
				return &parsed
			}
		}
	}
	return nil
}

func workspaceItemsFromAny(value any, source string) []model.DocumentEditorWorkspaceItem {
	switch v := value.(type) {
	case []map[string]any:
		out := make([]model.DocumentEditorWorkspaceItem, 0, len(v))
		for _, item := range v {
			out = append(out, workspaceItemFromMap(item, source))
		}
		return out
	case []any:
		out := make([]model.DocumentEditorWorkspaceItem, 0, len(v))
		for _, item := range v {
			switch raw := item.(type) {
			case map[string]any:
				out = append(out, workspaceItemFromMap(raw, source))
			default:
				title := stringFromAny(raw)
				if title != "" {
					out = append(out, model.DocumentEditorWorkspaceItem{Key: strings.ToLower(strings.ReplaceAll(title, " ", "_")), Title: title, Source: source})
				}
			}
		}
		return out
	case []string:
		out := make([]model.DocumentEditorWorkspaceItem, 0, len(v))
		for _, item := range v {
			title := strings.TrimSpace(item)
			if title == "" {
				continue
			}
			out = append(out, model.DocumentEditorWorkspaceItem{Key: strings.ToLower(strings.ReplaceAll(title, " ", "_")), Title: title, Source: source})
		}
		return out
	case map[string]any:
		if nested := firstAny(v, "items", "checks", "clauses", "issues"); nested != nil {
			return workspaceItemsFromAny(nested, source)
		}
		return []model.DocumentEditorWorkspaceItem{workspaceItemFromMap(v, source)}
	default:
		return nil
	}
}

func workspaceItemFromMap(values map[string]any, source string) model.DocumentEditorWorkspaceItem {
	itemSource := firstNonEmpty(stringFromKeys(values, "source"), source)
	return model.DocumentEditorWorkspaceItem{
		Key:              stringFromKeys(values, "key", "id", "code"),
		Title:            firstNonEmpty(stringFromKeys(values, "title", "name", "summary", "message"), stringFromKeys(values, "clause_type", "clauseType"), "Review item"),
		Status:           stringFromKeys(values, "status"),
		Severity:         stringFromKeys(values, "severity", "risk_level", "riskLevel"),
		SectionReference: stringFromKeys(values, "section_reference", "sectionReference", "section"),
		Owner:            stringFromKeys(values, "owner", "owner_name", "ownerName", "assignee_name", "assigneeName"),
		Source:           itemSource,
		DueAt:            timePtrFromAny(firstAny(values, "due_at", "dueAt", "deadline")),
		Metadata:         copyStringAnyMap(values),
	}
}

func participantsFromAny(value any) []model.DocumentEditorParticipant {
	switch v := value.(type) {
	case []map[string]any:
		out := make([]model.DocumentEditorParticipant, 0, len(v))
		for _, item := range v {
			out = append(out, participantFromMap(item))
		}
		return out
	case []any:
		out := make([]model.DocumentEditorParticipant, 0, len(v))
		for _, item := range v {
			switch raw := item.(type) {
			case map[string]any:
				out = append(out, participantFromMap(raw))
			default:
				name := stringFromAny(raw)
				if name != "" {
					out = append(out, model.DocumentEditorParticipant{Name: name})
				}
			}
		}
		return out
	default:
		return nil
	}
}

func participantFromMap(values map[string]any) model.DocumentEditorParticipant {
	var userID *uuid.UUID
	if id, ok := uuidFromAny(firstAny(values, "user_id", "userId")); ok {
		userID = &id
	}
	email := stringFromKeys(values, "email")
	return model.DocumentEditorParticipant{
		UserID:       userID,
		Name:         stringFromKeys(values, "name", "display_name", "displayName"),
		Email:        email,
		Role:         stringFromKeys(values, "role"),
		Organization: stringFromKeys(values, "organization", "org"),
		Status:       stringFromKeys(values, "status"),
		External:     boolFromAny(firstAny(values, "external", "is_external", "isExternal")) || email != "",
		Metadata:     copyStringAnyMap(values),
	}
}

func timelineEventsFromAudit(audit []model.DocumentEditorAuditEntry, limit int) []model.DocumentEditorTimelineEvent {
	if limit <= 0 || len(audit) == 0 {
		return nil
	}
	out := make([]model.DocumentEditorTimelineEvent, 0, editorMinInt(limit, len(audit)))
	for _, entry := range audit {
		out = append(out, model.DocumentEditorTimelineEvent{
			Action:      entry.Action,
			ActorUserID: entry.ActorUserID,
			CreatedAt:   entry.CreatedAt,
			Detail:      copyStringAnyMap(entry.Detail),
		})
		if len(out) >= limit {
			break
		}
	}
	return out
}

func definedTermsFromAny(value any) []model.DocumentEditorDefinedTerm {
	switch v := value.(type) {
	case []map[string]any:
		out := make([]model.DocumentEditorDefinedTerm, 0, len(v))
		for _, item := range v {
			out = append(out, definedTermFromMap(item))
		}
		return out
	case []any:
		out := make([]model.DocumentEditorDefinedTerm, 0, len(v))
		for _, item := range v {
			switch raw := item.(type) {
			case map[string]any:
				out = append(out, definedTermFromMap(raw))
			default:
				term := stringFromAny(raw)
				if term != "" {
					out = append(out, model.DocumentEditorDefinedTerm{Term: term, Occurrences: 1})
				}
			}
		}
		return out
	default:
		return nil
	}
}

func definedTermFromMap(values map[string]any) model.DocumentEditorDefinedTerm {
	occurrences := intFromAnyDefault(firstAny(values, "occurrences", "count"), 0)
	if occurrences == 0 {
		if list := stringSliceFromAny(values["references"]); len(list) > 0 {
			occurrences = len(list)
		} else {
			occurrences = 1
		}
	}
	return model.DocumentEditorDefinedTerm{
		Term:             stringFromKeys(values, "term", "name"),
		Definition:       stringFromKeys(values, "definition", "meaning"),
		SectionReference: stringFromKeys(values, "section_reference", "sectionReference", "section"),
		Occurrences:      occurrences,
		Metadata:         copyStringAnyMap(values),
	}
}

func crossReferencesFromAny(value any) []model.DocumentEditorCrossReference {
	switch v := value.(type) {
	case []map[string]any:
		out := make([]model.DocumentEditorCrossReference, 0, len(v))
		for _, item := range v {
			out = append(out, crossReferenceFromMap(item))
		}
		return out
	case []any:
		out := make([]model.DocumentEditorCrossReference, 0, len(v))
		for _, item := range v {
			switch raw := item.(type) {
			case map[string]any:
				out = append(out, crossReferenceFromMap(raw))
			default:
				ref := stringFromAny(raw)
				if ref != "" {
					out = append(out, model.DocumentEditorCrossReference{Reference: ref})
				}
			}
		}
		return out
	default:
		return nil
	}
}

func crossReferenceFromMap(values map[string]any) model.DocumentEditorCrossReference {
	return model.DocumentEditorCrossReference{
		Reference:        firstNonEmpty(stringFromKeys(values, "reference", "source"), stringFromKeys(values, "label")),
		Target:           stringFromKeys(values, "target", "target_section", "targetSection"),
		Status:           stringFromKeys(values, "status"),
		SectionReference: stringFromKeys(values, "section_reference", "sectionReference", "section"),
		Metadata:         copyStringAnyMap(values),
	}
}

var (
	editorDefinedTermPattern = regexp.MustCompile(`(?i)"([^"]{2,80})"\s+(?:means|shall mean|means the|refers to)`)
	editorCrossRefPattern    = regexp.MustCompile(`(?i)\b(section|clause|article)\s+([0-9]+(?:\.[0-9]+)*)\b`)
)

func extractDefinedTermsFromText(text string) []model.DocumentEditorDefinedTerm {
	matches := editorDefinedTermPattern.FindAllStringSubmatch(text, 100)
	counts := map[string]int{}
	order := []string{}
	for _, match := range matches {
		term := strings.TrimSpace(match[1])
		if term == "" {
			continue
		}
		key := strings.ToLower(term)
		if counts[key] == 0 {
			order = append(order, term)
		}
		counts[key]++
	}
	out := make([]model.DocumentEditorDefinedTerm, 0, len(order))
	for _, term := range order {
		out = append(out, model.DocumentEditorDefinedTerm{Term: term, Occurrences: counts[strings.ToLower(term)]})
	}
	return out
}

func extractCrossReferencesFromText(text string) []model.DocumentEditorCrossReference {
	matches := editorCrossRefPattern.FindAllStringSubmatch(text, 150)
	seen := map[string]struct{}{}
	out := []model.DocumentEditorCrossReference{}
	for _, match := range matches {
		ref := strings.TrimSpace(match[1] + " " + match[2])
		key := strings.ToLower(ref)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, model.DocumentEditorCrossReference{Reference: ref, Target: match[2], Status: "referenced"})
	}
	return out
}

func sectionAssignmentsFromAny(value any) []model.DocumentEditorSectionAssignment {
	switch v := value.(type) {
	case []map[string]any:
		out := make([]model.DocumentEditorSectionAssignment, 0, len(v))
		for _, item := range v {
			out = append(out, sectionAssignmentFromMap(item))
		}
		return out
	case []any:
		out := make([]model.DocumentEditorSectionAssignment, 0, len(v))
		for _, item := range v {
			if raw, ok := item.(map[string]any); ok {
				out = append(out, sectionAssignmentFromMap(raw))
			}
		}
		return out
	default:
		return nil
	}
}

func sectionAssignmentFromMap(values map[string]any) model.DocumentEditorSectionAssignment {
	var assigneeID *uuid.UUID
	if id, ok := uuidFromAny(firstAny(values, "assignee_id", "assigneeId")); ok {
		assigneeID = &id
	}
	return model.DocumentEditorSectionAssignment{
		ID:               stringFromKeys(values, "id", "key"),
		SectionID:        stringFromKeys(values, "section_id", "sectionId"),
		Title:            firstNonEmpty(stringFromKeys(values, "title", "section_title", "sectionTitle"), "Section review"),
		SectionReference: stringFromKeys(values, "section_reference", "sectionReference", "section"),
		AssigneeID:       assigneeID,
		AssigneeName:     stringFromKeys(values, "assignee_name", "assigneeName", "owner"),
		Role:             stringFromKeys(values, "role"),
		Status:           firstNonEmpty(stringFromKeys(values, "status"), "open"),
		DueAt:            timePtrFromAny(firstAny(values, "due_at", "dueAt", "deadline")),
		Metadata:         copyStringAnyMap(values),
	}
}

func documentEditorSectionAssignmentFromRecord(record model.DocumentEditorSectionAssignmentRecord) model.DocumentEditorSectionAssignment {
	return model.DocumentEditorSectionAssignment{
		ID:               record.ID.String(),
		SectionID:        record.SectionID,
		Title:            firstNonEmpty(record.Title, "Section review"),
		SectionReference: record.SectionReference,
		AssigneeID:       record.AssigneeID,
		AssigneeName:     record.AssigneeName,
		Role:             record.Role,
		Status:           firstNonEmpty(record.Status, "open"),
		DueAt:            record.DueAt,
		Metadata:         copyStringAnyMap(record.Metadata),
	}
}

func legalIssuesFromWorkspace(workspace *documentEditorWorkspaceContext) []model.DocumentEditorLegalIssue {
	if len(workspace.legalIssues) > 0 {
		return limitLegalIssues(workspace.legalIssues, 100)
	}
	section := workspaceSection(workspace.workspaceMetadata, "legal_issues", "legalIssues", "issues")
	issues := legalIssuesFromAny(firstAny(section, "issues", "items"), "metadata")
	issues = append(issues, legalIssuesFromAny(workspace.contractAnalysis["key_findings"], "contract_analysis")...)
	issues = append(issues, legalIssuesFromAny(workspace.contractAnalysis["compliance_flags"], "contract_analysis")...)
	for _, clause := range workspace.contractClauses {
		riskLevel := stringFromKeys(clause, "risk_level", "riskLevel")
		riskScore, _ := floatFromAny(firstAny(clause, "risk_score", "riskScore"))
		if !highSeverity(riskLevel) && riskScore < 55 {
			continue
		}
		var clauseID *uuid.UUID
		if id, ok := uuidFromAny(clause["id"]); ok {
			clauseID = &id
		}
		issues = append(issues, model.DocumentEditorLegalIssue{
			ID:               stringFromKeys(clause, "id"),
			Title:            firstNonEmpty(stringFromKeys(clause, "title"), stringFromKeys(clause, "clause_type", "clauseType"), "High-risk clause"),
			Description:      stringFromKeys(clause, "analysis_summary", "analysisSummary"),
			Severity:         firstNonEmpty(riskLevel, "medium"),
			Status:           firstNonEmpty(stringFromKeys(clause, "review_status", "reviewStatus"), "open"),
			SectionReference: stringFromKeys(clause, "section_reference", "sectionReference"),
			Source:           "contract_clause",
			ClauseID:         clauseID,
			Metadata:         copyStringAnyMap(clause),
		})
	}
	return limitLegalIssues(issues, 100)
}

func documentEditorLegalIssueFromRecord(record model.DocumentEditorLegalIssueRecord) model.DocumentEditorLegalIssue {
	id := record.ID.String()
	if record.ExternalID != nil && strings.TrimSpace(*record.ExternalID) != "" {
		id = strings.TrimSpace(*record.ExternalID)
	}
	metadata := copyStringAnyMap(record.Metadata)
	if record.AnchorID != nil {
		metadata["anchor_id"] = record.AnchorID.String()
	}
	if record.DueAt != nil {
		metadata["due_at"] = record.DueAt.Format(time.RFC3339)
	}
	return model.DocumentEditorLegalIssue{
		ID:               id,
		Title:            firstNonEmpty(record.Title, "Legal issue"),
		Description:      record.Description,
		Severity:         firstNonEmpty(record.Severity, "medium"),
		Status:           firstNonEmpty(record.Status, "open"),
		SectionReference: record.SectionReference,
		Owner:            record.OwnerName,
		Source:           firstNonEmpty(record.Source, "workspace"),
		Metadata:         metadata,
	}
}

func legalIssuesFromAny(value any, source string) []model.DocumentEditorLegalIssue {
	switch v := value.(type) {
	case []map[string]any:
		out := make([]model.DocumentEditorLegalIssue, 0, len(v))
		for _, item := range v {
			out = append(out, legalIssueFromMap(item, source))
		}
		return out
	case []any:
		out := make([]model.DocumentEditorLegalIssue, 0, len(v))
		for _, item := range v {
			switch raw := item.(type) {
			case map[string]any:
				out = append(out, legalIssueFromMap(raw, source))
			default:
				title := stringFromAny(raw)
				if title != "" {
					out = append(out, model.DocumentEditorLegalIssue{Title: title, Severity: "medium", Status: "open", Source: source})
				}
			}
		}
		return out
	default:
		return nil
	}
}

func legalIssueFromMap(values map[string]any, source string) model.DocumentEditorLegalIssue {
	var clauseID *uuid.UUID
	if id, ok := uuidFromAny(firstAny(values, "clause_id", "clauseId")); ok {
		clauseID = &id
	}
	return model.DocumentEditorLegalIssue{
		ID:               stringFromKeys(values, "id", "key", "code"),
		Title:            firstNonEmpty(stringFromKeys(values, "title", "summary", "code"), "Legal issue"),
		Description:      stringFromKeys(values, "description", "message"),
		Severity:         firstNonEmpty(stringFromKeys(values, "severity", "risk_level", "riskLevel"), "medium"),
		Status:           firstNonEmpty(stringFromKeys(values, "status"), "open"),
		SectionReference: stringFromKeys(values, "section_reference", "sectionReference", "section", "clause_reference", "clauseReference"),
		Owner:            stringFromKeys(values, "owner", "owner_name", "ownerName"),
		Source:           firstNonEmpty(stringFromKeys(values, "source"), source),
		ClauseID:         clauseID,
		Metadata:         copyStringAnyMap(values),
	}
}

func signatureSignersFromAny(value any) []model.DocumentEditorSignatureSigner {
	switch v := value.(type) {
	case []map[string]any:
		out := make([]model.DocumentEditorSignatureSigner, 0, len(v))
		for _, item := range v {
			out = append(out, signatureSignerFromMap(item))
		}
		return out
	case []any:
		out := make([]model.DocumentEditorSignatureSigner, 0, len(v))
		for _, item := range v {
			if raw, ok := item.(map[string]any); ok {
				out = append(out, signatureSignerFromMap(raw))
			}
		}
		return out
	default:
		return nil
	}
}

func signatureSignersFromRecipients(recipients []map[string]any) []model.DocumentEditorSignatureSigner {
	out := make([]model.DocumentEditorSignatureSigner, 0, len(recipients))
	for _, recipient := range recipients {
		out = append(out, signatureSignerFromMap(recipient))
	}
	return out
}

func signatureSignerFromMap(values map[string]any) model.DocumentEditorSignatureSigner {
	var userID *uuid.UUID
	if id, ok := uuidFromAny(firstAny(values, "user_id", "userId")); ok {
		userID = &id
	}
	return model.DocumentEditorSignatureSigner{
		UserID:   userID,
		Name:     stringFromKeys(values, "name"),
		Email:    stringFromKeys(values, "email"),
		Role:     stringFromKeys(values, "role"),
		Status:   firstNonEmpty(stringFromKeys(values, "status"), "draft"),
		SignedAt: timePtrFromAny(firstAny(values, "signed_at", "signedAt")),
	}
}

func healthChecksFromAny(value any) []model.DocumentEditorHealthCheck {
	switch v := value.(type) {
	case []map[string]any:
		out := make([]model.DocumentEditorHealthCheck, 0, len(v))
		for _, item := range v {
			out = append(out, healthCheckFromMap(item))
		}
		return out
	case []any:
		out := make([]model.DocumentEditorHealthCheck, 0, len(v))
		for _, item := range v {
			if raw, ok := item.(map[string]any); ok {
				out = append(out, healthCheckFromMap(raw))
			}
		}
		return out
	default:
		return nil
	}
}

func healthCheckFromMap(values map[string]any) model.DocumentEditorHealthCheck {
	impact, _ := floatFromAny(firstAny(values, "score_impact", "scoreImpact"))
	return model.DocumentEditorHealthCheck{
		Key:         stringFromKeys(values, "key", "id"),
		Status:      firstNonEmpty(stringFromKeys(values, "status"), "unknown"),
		Severity:    stringFromKeys(values, "severity"),
		Message:     stringFromKeys(values, "message", "title", "summary"),
		ScoreImpact: impact,
		Metadata:    copyStringAnyMap(values),
	}
}

func countHighRiskClauses(clauses []map[string]any) int {
	count := 0
	for _, clause := range clauses {
		score, _ := floatFromAny(firstAny(clause, "risk_score", "riskScore"))
		if highSeverity(stringFromKeys(clause, "risk_level", "riskLevel")) || score >= 55 {
			count++
		}
	}
	return count
}

func closedStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "closed", "complete", "completed", "resolved", "approved", "waived", "done", "signed":
		return true
	default:
		return false
	}
}

func highSeverity(severity string) bool {
	switch strings.ToLower(strings.TrimSpace(severity)) {
	case "critical", "high":
		return true
	default:
		return false
	}
}

func limitLegalIssues(items []model.DocumentEditorLegalIssue, limit int) []model.DocumentEditorLegalIssue {
	if limit <= 0 || len(items) <= limit {
		return items
	}
	return items[:limit]
}

func limitWorkspaceItems(items []model.DocumentEditorWorkspaceItem, limit int) []model.DocumentEditorWorkspaceItem {
	if limit <= 0 || len(items) <= limit {
		return items
	}
	return items[:limit]
}

func boolFromAnyWithDefault(value any, fallback bool) bool {
	if value == nil {
		return fallback
	}
	if parsed, ok := value.(bool); ok {
		return parsed
	}
	raw := strings.ToLower(strings.TrimSpace(stringFromAny(value)))
	switch raw {
	case "true", "yes", "1", "enabled":
		return true
	case "false", "no", "0", "disabled":
		return false
	default:
		return fallback
	}
}

func controlReason(active bool, reason string) string {
	if !active {
		return ""
	}
	return reason
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func editorMinInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func roundEditorScore(score float64) float64 {
	return math.Round(score*10) / 10
}

func healthStatus(score float64) string {
	switch {
	case score >= 80:
		return "healthy"
	case score >= 60:
		return "warning"
	default:
		return "critical"
	}
}

func guestReviewTTL(value *int) time.Duration {
	if value == nil || *value <= 0 {
		return defaultGuestReviewTTL
	}
	duration := time.Duration(*value) * time.Second
	if duration > maxGuestReviewTTL {
		return maxGuestReviewTTL
	}
	return duration
}

func validEditorActionKey(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 64 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' {
			continue
		}
		return false
	}
	return true
}

func effectiveEditorPermissionMode(requested model.DocumentEditorMode, actorID uuid.UUID, lock *model.DocumentEditorLock) model.DocumentEditorMode {
	if requested == model.DocumentEditorModeView {
		return model.DocumentEditorModeView
	}
	if lock != nil && lock.LockedBy != actorID {
		return model.DocumentEditorModeView
	}
	return requested
}

func buildDocumentEditorConfig(document *model.LegalDocument, session *model.DocumentEditorSession, lock *model.DocumentEditorLock, actor EditorActor, req dto.OpenDocumentEditorSessionRequest, callbackToken string) model.DocumentEditorConfig {
	permissions := editorPermissions(session.PermissionMode)
	fileName := ""
	if document.FileName != nil {
		fileName = *document.FileName
	}
	fileType := editorFileType(fileName)
	documentURL := strings.TrimSpace(req.DocumentURL)
	if documentURL == "" && document.FileID != nil {
		documentURL = joinBaseURL(req.BaseURL, "/api/v1/files/"+document.FileID.String()+"/download")
	}
	userName := actor.DisplayName
	if userName == "" {
		userName = actor.Email
	}
	if userName == "" {
		userName = actor.UserID.String()
	}

	documentConfig := map[string]any{
		"id":          document.ID.String(),
		"title":       document.Title,
		"fileType":    fileType,
		"key":         session.ProviderDocumentKey,
		"url":         documentURL,
		"version":     document.CurrentVersion,
		"permissions": onlyOfficePermissions(permissions),
	}
	editorConfig := map[string]any{
		"mode":        string(session.PermissionMode),
		"callbackUrl": stringValueOrEmpty(session.CallbackURL),
		"lang":        req.Locale,
		"user": map[string]any{
			"id":    actor.UserID.String(),
			"name":  userName,
			"email": actor.Email,
		},
		"customization": map[string]any{
			"autosave":      true,
			"forcesave":     true,
			"comments":      permissions.Comment,
			"compactHeader": false,
			"feedback":      false,
			"help":          true,
			"hideRightMenu": false,
			"reviewDisplay": "markup",
			"submitForm":    false,
			"toolbarNoTabs": false,
			"unit":          "cm",
			"zoom":          100,
		},
	}
	metadata := map[string]any{
		"session_id":            session.ID.String(),
		"document_id":           document.ID.String(),
		"callback_token":        callbackToken,
		"provider_document_key": session.ProviderDocumentKey,
		"requested_mode":        string(session.RequestedMode),
		"permission_mode":       string(session.PermissionMode),
		"autosave":              true,
		"version_snapshot_hook": "document_version_snapshot_placeholder",
	}
	if lock != nil {
		metadata["active_lock_id"] = lock.ID.String()
		metadata["locked_by"] = lock.LockedBy.String()
	}
	return model.DocumentEditorConfig{
		Provider:     session.Provider,
		DocumentType: "word",
		Document:     documentConfig,
		EditorConfig: editorConfig,
		Permissions:  permissions,
		ProviderConfig: map[string]any{
			"onlyoffice": map[string]any{
				"documentType": "word",
				"configShape":  "document-editor",
			},
		},
		Metadata: metadata,
	}
}

func editorPermissions(mode model.DocumentEditorMode) model.DocumentEditorPermissions {
	permissions := model.DocumentEditorPermissions{
		Mode:     mode,
		Download: true,
		Print:    true,
		Copy:     true,
	}
	switch mode {
	case model.DocumentEditorModeEdit:
		permissions.Edit = true
		permissions.Comment = true
		permissions.Review = true
	case model.DocumentEditorModeComment:
		permissions.Comment = true
		permissions.Review = true
	}
	return permissions
}

func onlyOfficePermissions(p model.DocumentEditorPermissions) map[string]any {
	return map[string]any{
		"edit":         p.Edit,
		"comment":      p.Comment,
		"review":       p.Review,
		"download":     p.Download,
		"print":        p.Print,
		"copy":         p.Copy,
		"fillForms":    p.Edit,
		"modifyFilter": p.Edit,
	}
}

func editorDocumentSummary(document *model.LegalDocument) model.DocumentEditorDocument {
	fileType := ""
	if document.FileName != nil {
		fileType = editorFileType(*document.FileName)
	}
	return model.DocumentEditorDocument{
		ID:             document.ID,
		Title:          document.Title,
		FileID:         document.FileID,
		FileName:       document.FileName,
		FileType:       fileType,
		CurrentVersion: document.CurrentVersion,
	}
}

func buildPreflightPayload(req dto.SubmitDocumentEditorPreflightRequest, recordedAt time.Time) map[string]any {
	checks := make([]any, 0, len(req.Checks))
	for _, check := range req.Checks {
		checks = append(checks, map[string]any{
			"key":      check.Key,
			"status":   check.Status,
			"severity": check.Severity,
			"message":  check.Message,
			"metadata": check.Metadata,
		})
	}
	payload := map[string]any{
		"status":      req.Status,
		"blocking":    req.Blocking,
		"summary":     req.Summary,
		"checks":      checks,
		"metadata":    req.Metadata,
		"recorded_at": recordedAt.Format(time.RFC3339),
	}
	if req.Score != nil {
		payload["score"] = *req.Score
	}
	if req.SessionID != nil {
		payload["session_id"] = req.SessionID.String()
	}
	return payload
}

func buildEditorProviderDocumentKey(tenantID, documentID uuid.UUID, version int) string {
	sum := sha256.Sum256([]byte(tenantID.String() + ":" + documentID.String() + ":" + strconv.Itoa(version)))
	return "lex-" + hex.EncodeToString(sum[:])[:40]
}

func buildEditorCallbackURL(baseURL, routePrefix string, documentID, sessionID uuid.UUID) string {
	prefix := strings.TrimRight(routePrefix, "/")
	if prefix == "" {
		prefix = "/api/v1/lex"
	}
	callbackPath := prefix + "/documents/" + documentID.String() + "/editor/callback"
	fullURL := joinBaseURL(baseURL, callbackPath)
	parsed, err := url.Parse(fullURL)
	if err != nil {
		return fullURL
	}
	query := parsed.Query()
	query.Set("session_id", sessionID.String())
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func decorateEditorCallbackURL(callbackURL string, sessionID uuid.UUID, callbackToken string) string {
	callbackURL = strings.ReplaceAll(strings.TrimSpace(callbackURL), "{session_id}", sessionID.String())
	parsed, err := url.Parse(callbackURL)
	if err != nil {
		return callbackURL
	}
	query := parsed.Query()
	if query.Get("session_id") == "" {
		query.Set("session_id", sessionID.String())
	}
	if strings.TrimSpace(callbackToken) != "" && query.Get("callback_token") == "" {
		query.Set("callback_token", callbackToken)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func joinBaseURL(baseURL, itemPath string) string {
	itemPath = "/" + strings.TrimLeft(itemPath, "/")
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return itemPath
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return itemPath
	}
	parsed.Path = path.Join(parsed.Path, itemPath)
	return parsed.String()
}

func editorFileType(fileName string) string {
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(strings.TrimSpace(fileName)), "."))
	if ext == "" {
		return "docx"
	}
	return ext
}

func editorLockTTL(value *int) time.Duration {
	if value == nil || *value <= 0 {
		return defaultEditorLockTTL
	}
	duration := time.Duration(*value) * time.Second
	if duration > maxEditorLockTTL {
		return maxEditorLockTTL
	}
	return duration
}

func validEditorProvider(provider string) bool {
	if provider == "" || len(provider) > 64 {
		return false
	}
	for _, r := range provider {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			continue
		}
		return false
	}
	return true
}

func validPreflightStatus(status string) bool {
	switch status {
	case "passed", "warning", "failed":
		return true
	default:
		return false
	}
}

func editorProviderEventType(payload map[string]any) string {
	if eventType := strings.ToLower(strings.TrimSpace(stringFromAny(firstAny(payload, "event_type", "eventType", "type")))); eventType != "" {
		return eventType
	}
	if actions := mapsFromAny(payload["actions"]); len(actions) > 0 {
		actionType := strings.ToLower(strings.TrimSpace(stringFromKeys(actions[0], "type", "action")))
		switch actionType {
		case "0", "connect", "join", "joined":
			return "coauthor_joined"
		case "1", "disconnect", "leave", "left":
			return "coauthor_left"
		case "comment", "comment_created":
			return "comment_created"
		case "track_change_accepted", "change_accepted":
			return "track_change_accepted"
		}
	}
	status := strings.ToLower(strings.TrimSpace(stringFromAny(payload["status"])))
	switch status {
	case "1", "editing":
		return "editing"
	case "2", "saved", "save":
		return "saved"
	case "3", "save_error", "error":
		return "provider_error"
	case "4", "closed":
		return "closed_without_changes"
	case "6", "forcesaved", "force_saved":
		return "force_saved"
	case "7", "force_save_error":
		return "provider_error"
	default:
		if stringFromAny(payload["url"]) != "" {
			return "export_started"
		}
		return "callback_received"
	}
}

func isEditorSnapshotStatus(status any) bool {
	switch v := status.(type) {
	case float64:
		return int(v) == 2 || int(v) == 6
	case int:
		return v == 2 || v == 6
	case json.Number:
		i, err := strconv.Atoi(v.String())
		return err == nil && (i == 2 || i == 6)
	case string:
		normalized := strings.ToLower(strings.TrimSpace(v))
		return normalized == "2" || normalized == "6" || normalized == "saved" || normalized == "save" || normalized == "forcesaved" || normalized == "force_saved"
	default:
		return false
	}
}

func uuidFromAny(value any) (uuid.UUID, bool) {
	raw := strings.TrimSpace(stringFromAny(value))
	if raw == "" {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(raw)
	return id, err == nil
}

func stringValueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func editorPtrTime(value time.Time) *time.Time {
	return &value
}

func hashEditorCallbackToken(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}
