package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

type DocumentEditorRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewDocumentEditorRepository(db *pgxpool.Pool, logger zerolog.Logger) *DocumentEditorRepository {
	return &DocumentEditorRepository{db: db, logger: logger}
}

func (r *DocumentEditorRepository) GetDocumentForEditor(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID) (*model.LegalDocument, error) {
	query := documentJSONSelect(`d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`)
	return queryRowJSON[model.LegalDocument](ctx, q, query, tenantID, documentID)
}

func (r *DocumentEditorRepository) CreateSession(ctx context.Context, q Queryer, session *model.DocumentEditorSession) error {
	autosaveJSON, err := json.Marshal(orEmptyMap(session.AutosaveMetadata))
	if err != nil {
		return fmt.Errorf("marshal editor autosave metadata: %w", err)
	}
	lastCallbackJSON, err := json.Marshal(orEmptyMap(session.LastCallback))
	if err != nil {
		return fmt.Errorf("marshal editor last callback: %w", err)
	}
	preflightJSON, err := json.Marshal(orEmptyMap(session.PreflightResult))
	if err != nil {
		return fmt.Errorf("marshal editor preflight result: %w", err)
	}
	snapshotJSON, err := json.Marshal(orEmptyMap(session.SnapshotMetadata))
	if err != nil {
		return fmt.Errorf("marshal editor snapshot metadata: %w", err)
	}
	query := `
		INSERT INTO lex_document_editor_sessions (
			id, tenant_id, document_id, provider, requested_mode, permission_mode,
			status, provider_document_key, document_version, callback_url, callback_token_hash,
			autosave_metadata, last_callback, preflight_result, snapshot_metadata,
			created_by, expires_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,$11,
			$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,
			$16,$17
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		session.ID, session.TenantID, session.DocumentID, session.Provider,
		session.RequestedMode, session.PermissionMode, session.Status,
		session.ProviderDocumentKey, session.DocumentVersion, session.CallbackURL,
		session.CallbackTokenHash, autosaveJSON, lastCallbackJSON, preflightJSON,
		snapshotJSON, session.CreatedBy, session.ExpiresAt,
	).Scan(&session.CreatedAt, &session.UpdatedAt)
}

func (r *DocumentEditorRepository) GetSession(ctx context.Context, q Queryer, tenantID, sessionID uuid.UUID) (*model.DocumentEditorSession, error) {
	query := documentEditorSessionJSONSelect(`s.tenant_id = $1 AND s.id = $2`)
	return queryRowJSON[model.DocumentEditorSession](ctx, q, query, tenantID, sessionID)
}

func (r *DocumentEditorRepository) GetSessionCallbackTokenHash(ctx context.Context, q Queryer, tenantID, sessionID uuid.UUID) (*string, error) {
	var hash *string
	if err := q.QueryRow(ctx, `
		SELECT callback_token_hash
		FROM lex_document_editor_sessions
		WHERE tenant_id = $1 AND id = $2`,
		tenantID, sessionID,
	).Scan(&hash); err != nil {
		return nil, err
	}
	return hash, nil
}

func (r *DocumentEditorRepository) GetLatestActiveSessionByProviderKey(ctx context.Context, q Queryer, tenantID uuid.UUID, provider, providerDocumentKey string) (*model.DocumentEditorSession, error) {
	query := documentEditorSessionJSONSelectWithSuffix(
		`s.tenant_id = $1 AND s.provider = $2 AND s.provider_document_key = $3 AND s.status = 'active'`,
		` ORDER BY s.updated_at DESC LIMIT 1`,
	)
	return queryRowJSON[model.DocumentEditorSession](ctx, q, query, tenantID, provider, providerDocumentKey)
}

func (r *DocumentEditorRepository) UpdateSessionCallback(ctx context.Context, q Queryer, tenantID, sessionID uuid.UUID, callback, autosave, snapshot map[string]any) (*model.DocumentEditorSession, error) {
	callbackJSON, err := json.Marshal(orEmptyMap(callback))
	if err != nil {
		return nil, fmt.Errorf("marshal editor callback: %w", err)
	}
	autosaveJSON, err := json.Marshal(orEmptyMap(autosave))
	if err != nil {
		return nil, fmt.Errorf("marshal editor autosave metadata: %w", err)
	}
	snapshotJSON, err := json.Marshal(orEmptyMap(snapshot))
	if err != nil {
		return nil, fmt.Errorf("marshal editor snapshot metadata: %w", err)
	}
	query := `
		UPDATE lex_document_editor_sessions
		SET last_callback = $3::jsonb,
		    autosave_metadata = $4::jsonb,
		    snapshot_metadata = $5::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2
		RETURNING id`
	var id uuid.UUID
	if err := q.QueryRow(ctx, query, tenantID, sessionID, callbackJSON, autosaveJSON, snapshotJSON).Scan(&id); err != nil {
		return nil, err
	}
	return r.GetSession(ctx, q, tenantID, id)
}

func (r *DocumentEditorRepository) UpdateSessionPreflight(ctx context.Context, q Queryer, tenantID, sessionID uuid.UUID, preflight map[string]any) (*model.DocumentEditorSession, error) {
	preflightJSON, err := json.Marshal(orEmptyMap(preflight))
	if err != nil {
		return nil, fmt.Errorf("marshal editor preflight: %w", err)
	}
	query := `
		UPDATE lex_document_editor_sessions
		SET preflight_result = $3::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2
		RETURNING id`
	var id uuid.UUID
	if err := q.QueryRow(ctx, query, tenantID, sessionID, preflightJSON).Scan(&id); err != nil {
		return nil, err
	}
	return r.GetSession(ctx, q, tenantID, id)
}

func (r *DocumentEditorRepository) ExpireDocumentLocks(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		UPDATE lex_document_editor_locks
		SET status = 'expired', released_at = now()
		WHERE tenant_id = $1
		  AND document_id = $2
		  AND released_at IS NULL
		  AND expires_at IS NOT NULL
		  AND expires_at <= now()`,
		tenantID, documentID,
	)
	return err
}

func (r *DocumentEditorRepository) GetActiveLock(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID) (*model.DocumentEditorLock, error) {
	query := documentEditorLockJSONSelect(`l.tenant_id = $1 AND l.document_id = $2 AND l.released_at IS NULL`)
	return queryRowJSON[model.DocumentEditorLock](ctx, q, query, tenantID, documentID)
}

func (r *DocumentEditorRepository) CreateLock(ctx context.Context, q Queryer, lock *model.DocumentEditorLock) error {
	metadataJSON, err := json.Marshal(orEmptyMap(lock.Metadata))
	if err != nil {
		return fmt.Errorf("marshal editor lock metadata: %w", err)
	}
	query := `
		INSERT INTO lex_document_editor_locks (
			id, tenant_id, document_id, session_id, lock_type, status, reason,
			locked_by, expires_at, metadata
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
		RETURNING locked_at`
	return q.QueryRow(ctx, query,
		lock.ID, lock.TenantID, lock.DocumentID, lock.SessionID, lock.LockType,
		lock.Status, lock.Reason, lock.LockedBy, lock.ExpiresAt, metadataJSON,
	).Scan(&lock.LockedAt)
}

func (r *DocumentEditorRepository) ReleaseActiveLock(ctx context.Context, q Queryer, tenantID, documentID, actorID uuid.UUID, sessionID *uuid.UUID, reason string) (*model.DocumentEditorLock, error) {
	args := []any{tenantID, documentID, actorID, reason}
	sessionPredicate := ""
	if sessionID != nil {
		args = append(args, *sessionID)
		sessionPredicate = " AND session_id = $5"
	}
	query := `
		UPDATE lex_document_editor_locks
		SET status = 'released',
		    released_by = $3,
		    released_at = now(),
		    metadata = metadata || jsonb_build_object('release_reason', $4::text)
		WHERE tenant_id = $1
		  AND document_id = $2
		  AND released_at IS NULL
		  AND locked_by = $3` + sessionPredicate + `
		RETURNING id`
	var id uuid.UUID
	if err := q.QueryRow(ctx, query, args...).Scan(&id); err != nil {
		return nil, err
	}
	return r.GetLock(ctx, q, tenantID, id)
}

func (r *DocumentEditorRepository) GetLock(ctx context.Context, q Queryer, tenantID, lockID uuid.UUID) (*model.DocumentEditorLock, error) {
	query := documentEditorLockJSONSelect(`l.tenant_id = $1 AND l.id = $2`)
	return queryRowJSON[model.DocumentEditorLock](ctx, q, query, tenantID, lockID)
}

func (r *DocumentEditorRepository) AppendAudit(ctx context.Context, q Queryer, entry *model.DocumentEditorAuditEntry) error {
	detailJSON, err := json.Marshal(orEmptyMap(entry.Detail))
	if err != nil {
		return fmt.Errorf("marshal editor audit detail: %w", err)
	}
	query := `
		INSERT INTO lex_document_editor_audit (
			id, tenant_id, document_id, session_id, lock_id, action, provider, actor_user_id, detail
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		entry.ID, entry.TenantID, entry.DocumentID, entry.SessionID, entry.LockID,
		entry.Action, entry.Provider, entry.ActorUserID, detailJSON,
	).Scan(&entry.CreatedAt)
}

func (r *DocumentEditorRepository) ListAudit(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, limit, offset int) ([]model.DocumentEditorAuditEntry, int, error) {
	var total int
	if err := q.QueryRow(ctx, `SELECT COUNT(*) FROM lex_document_editor_audit WHERE tenant_id = $1 AND document_id = $2`, tenantID, documentID).Scan(&total); err != nil {
		return nil, 0, err
	}
	query := documentEditorAuditJSONSelectWithSuffix(`a.tenant_id = $1 AND a.document_id = $2`, ` ORDER BY a.created_at ASC LIMIT $3 OFFSET $4`)
	items, err := queryListJSON[model.DocumentEditorAuditEntry](ctx, q, query, tenantID, documentID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func documentEditorSessionJSONSelect(where string) string {
	return documentEditorSessionJSONSelectWithSuffix(where, "")
}

func documentEditorSessionJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT s.id, s.tenant_id, s.document_id, s.provider, s.requested_mode,
			       s.permission_mode, s.status, s.provider_document_key, s.document_version,
			       s.callback_url, COALESCE(s.autosave_metadata, '{}'::jsonb) AS autosave_metadata,
			       COALESCE(s.last_callback, '{}'::jsonb) AS last_callback,
			       COALESCE(s.preflight_result, '{}'::jsonb) AS preflight_result,
			       COALESCE(s.snapshot_metadata, '{}'::jsonb) AS snapshot_metadata,
			       s.created_by, s.created_at, s.updated_at, s.expires_at, s.closed_at
			FROM lex_document_editor_sessions s
			WHERE ` + where + suffix + `
		) t`
}

func documentEditorLockJSONSelect(where string) string {
	return documentEditorLockJSONSelectWithSuffix(where, "")
}

func documentEditorLockJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT l.id, l.tenant_id, l.document_id, l.session_id, l.lock_type, l.status,
			       l.reason, l.locked_by, l.locked_at, l.expires_at, l.released_by,
			       l.released_at, COALESCE(l.metadata, '{}'::jsonb) AS metadata
			FROM lex_document_editor_locks l
			WHERE ` + where + suffix + `
		) t`
}

func documentEditorAuditJSONSelect(where string) string {
	return documentEditorAuditJSONSelectWithSuffix(where, "")
}

func documentEditorAuditJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT a.id, a.tenant_id, a.document_id, a.session_id, a.lock_id, a.action,
			       a.provider, a.actor_user_id, COALESCE(a.detail, '{}'::jsonb) AS detail,
			       a.created_at
			FROM lex_document_editor_audit a
			WHERE ` + where + suffix + `
		) t`
}
