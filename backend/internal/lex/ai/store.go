package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// Store persists assistant sessions and transcripts (migration 000105). Every
// query carries an explicit (tenant_id, user_id) predicate; the tables' RLS
// policies on app.current_tenant_id are the backstop, matching the rest of
// lex_db. A session is private to the user who opened it — the legal director's
// transcripts are not visible to their team.
type Store struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

// NewStore constructs the assistant store.
func NewStore(db *pgxpool.Pool, logger zerolog.Logger) *Store {
	return &Store{db: db, logger: logger.With().Str("store", "lex-ai").Logger()}
}

// TurnRecord is one complete chat turn, persisted atomically: the question, one
// row per grounding-tool invocation, and the assistant's answer.
type TurnRecord struct {
	Session   *Session
	Question  string
	ToolCalls []ToolCallRecord
	Answer    string
	LatencyMS int
}

const insertSessionSQL = `
INSERT INTO lex_ai_sessions (tenant_id, user_id, title, provider, model)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, message_count, created_at, updated_at`

// CreateSession inserts a new session and populates its generated fields.
func (s *Store) CreateSession(ctx context.Context, sess *Session) error {
	err := s.db.QueryRow(ctx, insertSessionSQL,
		sess.TenantID, sess.UserID, sess.Title, sess.Provider, sess.Model,
	).Scan(&sess.ID, &sess.MessageCount, &sess.CreatedAt, &sess.UpdatedAt)
	if err != nil {
		return fmt.Errorf("lex ai: creating session: %w", err)
	}
	return nil
}

const sessionColumns = `id, tenant_id, user_id, title, provider, model, message_count, created_at, updated_at`

const selectSessionSQL = `
SELECT ` + sessionColumns + `
FROM lex_ai_sessions
WHERE tenant_id = $1 AND user_id = $2 AND id = $3`

// GetSession loads one of the caller's own sessions. Returns ErrNotFound when
// the session does not exist, belongs to another user, or to another tenant —
// the three cases are deliberately indistinguishable to the caller.
func (s *Store) GetSession(ctx context.Context, tenantID, userID, id uuid.UUID) (*Session, error) {
	sess, err := scanSession(s.db.QueryRow(ctx, selectSessionSQL, tenantID, userID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("lex ai: session %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("lex ai: loading session %s: %w", id, err)
	}
	return sess, nil
}

const listSessionsSQL = `
SELECT ` + sessionColumns + `
FROM lex_ai_sessions
WHERE tenant_id = $1 AND user_id = $2
ORDER BY updated_at DESC
LIMIT $3`

// ListSessions returns the caller's most recently updated sessions, newest
// first — the chat rail of the AI agent panel.
func (s *Store) ListSessions(ctx context.Context, tenantID, userID uuid.UUID, limit int) ([]Session, error) {
	rows, err := s.db.Query(ctx, listSessionsSQL, tenantID, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("lex ai: listing sessions: %w", err)
	}
	defer rows.Close()

	out := make([]Session, 0, limit)
	for rows.Next() {
		sess, scanErr := scanSession(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("lex ai: scanning session: %w", scanErr)
		}
		out = append(out, *sess)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("lex ai: reading sessions: %w", err)
	}
	return out, nil
}

const listMessagesSQL = `
SELECT id, session_id, tenant_id, user_id, seq, role, content, tool_name,
       tool_call_id, tool_calls, latency_ms, created_at
FROM lex_ai_messages
WHERE tenant_id = $1 AND session_id = $2
ORDER BY seq ASC`

// ListMessages returns a session's full transcript ordered by seq. Callers must
// have already authorised the session through GetSession.
func (s *Store) ListMessages(ctx context.Context, tenantID, sessionID uuid.UUID) ([]Message, error) {
	rows, err := s.db.Query(ctx, listMessagesSQL, tenantID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("lex ai: listing messages: %w", err)
	}
	defer rows.Close()

	var out []Message
	for rows.Next() {
		m, scanErr := scanMessage(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("lex ai: reading messages: %w", err)
	}
	return out, nil
}

const insertMessageSQL = `
INSERT INTO lex_ai_messages
    (session_id, tenant_id, user_id, seq, role, content, tool_name, tool_call_id, tool_calls, latency_ms)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING id, created_at`

const touchSessionSQL = `
UPDATE lex_ai_sessions
SET message_count = $3, updated_at = now()
WHERE tenant_id = $1 AND id = $2`

// AppendTurn writes the question, every grounding-tool row and the assistant
// answer in ONE transaction, then advances the session's message counter. The
// audit trail is therefore all-or-nothing: a failed write never leaves a
// half-recorded turn. Returns the assistant message id.
func (s *Store) AppendTurn(ctx context.Context, turn TurnRecord) (uuid.UUID, error) {
	if turn.Session == nil {
		return uuid.Nil, fmt.Errorf("lex ai: AppendTurn: session is required")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, fmt.Errorf("lex ai: beginning turn transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	sess := turn.Session
	seq := sess.MessageCount

	if _, err := appendMessage(ctx, tx, &Message{
		SessionID: sess.ID,
		TenantID:  sess.TenantID,
		UserID:    sess.UserID,
		Seq:       seq,
		Role:      RoleUser,
		Content:   turn.Question,
	}); err != nil {
		return uuid.Nil, err
	}
	seq++

	for _, record := range turn.ToolCalls {
		if _, err := appendMessage(ctx, tx, &Message{
			SessionID:  sess.ID,
			TenantID:   sess.TenantID,
			UserID:     sess.UserID,
			Seq:        seq,
			Role:       RoleTool,
			Content:    record.ResultSummary,
			ToolName:   record.Name,
			ToolCallID: record.ID,
		}); err != nil {
			return uuid.Nil, err
		}
		seq++
	}

	assistantID, err := appendMessage(ctx, tx, &Message{
		SessionID: sess.ID,
		TenantID:  sess.TenantID,
		UserID:    sess.UserID,
		Seq:       seq,
		Role:      RoleAssistant,
		Content:   turn.Answer,
		ToolCalls: turn.ToolCalls,
		LatencyMS: turn.LatencyMS,
	})
	if err != nil {
		return uuid.Nil, err
	}
	seq++

	tag, err := tx.Exec(ctx, touchSessionSQL, sess.TenantID, sess.ID, seq)
	if err != nil {
		return uuid.Nil, fmt.Errorf("lex ai: touching session %s: %w", sess.ID, err)
	}
	if tag.RowsAffected() == 0 {
		return uuid.Nil, fmt.Errorf("lex ai: session %s: %w", sess.ID, ErrNotFound)
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, fmt.Errorf("lex ai: committing turn: %w", err)
	}
	sess.MessageCount = seq
	return assistantID, nil
}

func appendMessage(ctx context.Context, tx pgx.Tx, m *Message) (uuid.UUID, error) {
	toolCalls := []byte("[]")
	if len(m.ToolCalls) > 0 {
		encoded, err := json.Marshal(m.ToolCalls)
		if err != nil {
			return uuid.Nil, fmt.Errorf("lex ai: marshalling tool_calls: %w", err)
		}
		toolCalls = encoded
	}
	err := tx.QueryRow(ctx, insertMessageSQL,
		m.SessionID, m.TenantID, m.UserID, m.Seq, m.Role, m.Content,
		nullableString(m.ToolName), nullableString(m.ToolCallID), toolCalls, m.LatencyMS,
	).Scan(&m.ID, &m.CreatedAt)
	if err != nil {
		return uuid.Nil, fmt.Errorf("lex ai: appending message seq %d: %w", m.Seq, err)
	}
	return m.ID, nil
}

// rowScanner is satisfied by both pgx.Row and pgx.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanSession(row rowScanner) (*Session, error) {
	var sess Session
	if err := row.Scan(
		&sess.ID, &sess.TenantID, &sess.UserID, &sess.Title, &sess.Provider,
		&sess.Model, &sess.MessageCount, &sess.CreatedAt, &sess.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &sess, nil
}

func scanMessage(rows pgx.Rows) (Message, error) {
	var m Message
	var toolName, toolCallID *string
	var toolCalls []byte
	if err := rows.Scan(
		&m.ID, &m.SessionID, &m.TenantID, &m.UserID, &m.Seq, &m.Role, &m.Content,
		&toolName, &toolCallID, &toolCalls, &m.LatencyMS, &m.CreatedAt,
	); err != nil {
		return Message{}, fmt.Errorf("lex ai: scanning message: %w", err)
	}
	if toolName != nil {
		m.ToolName = *toolName
	}
	if toolCallID != nil {
		m.ToolCallID = *toolCallID
	}
	if len(toolCalls) > 0 {
		if err := json.Unmarshal(toolCalls, &m.ToolCalls); err != nil {
			return Message{}, fmt.Errorf("lex ai: unmarshalling tool_calls: %w", err)
		}
	}
	return m, nil
}

func nullableString(v string) any {
	if v == "" {
		return nil
	}
	return v
}
