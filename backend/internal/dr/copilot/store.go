package copilot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

// Store persists copilot sessions and messages. Every method takes a
// repository.DBTX (the same pgx subset the rest of dr_db uses) so a write can
// run inside the caller's tenant-scoped transaction and RLS applies. It holds
// no state; tests can substitute it via the storeIface interface.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

const insertSessionSQL = `
INSERT INTO dr_copilot_session (tenant_id, user_id, title, provider, model)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, message_count, created_at, updated_at`

// CreateSession inserts a new copilot session and populates its generated
// fields. tenant_id must match the SET LOCAL app.current_tenant_id of the
// surrounding transaction or RLS rejects the insert.
func (s *Store) CreateSession(ctx context.Context, db repository.DBTX, sess *Session) error {
	if sess.Title == "" {
		sess.Title = "DR Copilot session"
	}
	err := db.QueryRow(ctx, insertSessionSQL,
		sess.TenantID, sess.UserID, sess.Title, sess.Provider, sess.Model,
	).Scan(&sess.ID, &sess.MessageCount, &sess.CreatedAt, &sess.UpdatedAt)
	if err != nil {
		return fmt.Errorf("copilot: creating session: %w", err)
	}
	return nil
}

const selectSessionSQL = `
SELECT id, tenant_id, user_id, title, provider, model, message_count, created_at, updated_at
FROM dr_copilot_session
WHERE tenant_id = $1 AND id = $2`

// GetSession loads a session by id within the tenant. Returns ErrNotFound when
// the session does not exist (or belongs to another tenant).
func (s *Store) GetSession(ctx context.Context, db repository.DBTX, tenantID, id string) (*Session, error) {
	var sess Session
	err := db.QueryRow(ctx, selectSessionSQL, tenantID, id).Scan(
		&sess.ID, &sess.TenantID, &sess.UserID, &sess.Title, &sess.Provider,
		&sess.Model, &sess.MessageCount, &sess.CreatedAt, &sess.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("copilot: session %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("copilot: loading session %s: %w", id, err)
	}
	return &sess, nil
}

const insertMessageSQL = `
INSERT INTO dr_copilot_message
    (session_id, tenant_id, seq, role, content, tool_name, tool_call_id, tool_calls, proposed_action, latency_ms)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING id, created_at`

// AppendMessage inserts one message into a session. seq must be monotonic
// within the session (the UNIQUE(session_id, seq) constraint enforces ordering
// and rejects races). tool_calls and proposed_action are stored as JSONB.
func (s *Store) AppendMessage(ctx context.Context, db repository.DBTX, m *Message) error {
	toolCalls, err := json.Marshal(m.ToolCalls)
	if err != nil {
		return fmt.Errorf("copilot: marshalling tool_calls: %w", err)
	}
	if len(m.ToolCalls) == 0 {
		toolCalls = []byte("[]")
	}
	var proposed any
	if m.ProposedAction != nil {
		raw, perr := json.Marshal(m.ProposedAction)
		if perr != nil {
			return fmt.Errorf("copilot: marshalling proposed_action: %w", perr)
		}
		proposed = raw
	}
	toolName := nullableString(m.ToolName)
	toolCallID := nullableString(m.ToolCallID)
	err = db.QueryRow(ctx, insertMessageSQL,
		m.SessionID, m.TenantID, m.Seq, m.Role, m.Content,
		toolName, toolCallID, toolCalls, proposed, m.LatencyMS,
	).Scan(&m.ID, &m.CreatedAt)
	if err != nil {
		return fmt.Errorf("copilot: appending message seq %d: %w", m.Seq, err)
	}
	return nil
}

const touchSessionSQL = `
UPDATE dr_copilot_session
SET message_count = $3, updated_at = now()
WHERE tenant_id = $1 AND id = $2`

// TouchSession updates the session's message count and updated_at. Returns
// ErrNotFound when no row matched the tenant + id.
func (s *Store) TouchSession(ctx context.Context, db repository.DBTX, tenantID, id string, messageCount int) error {
	tag, err := db.Exec(ctx, touchSessionSQL, tenantID, id, messageCount)
	if err != nil {
		return fmt.Errorf("copilot: touching session %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("copilot: session %s: %w", id, ErrNotFound)
	}
	return nil
}

const listMessagesSQL = `
SELECT id, session_id, tenant_id, seq, role, content, tool_name, tool_call_id,
       tool_calls, proposed_action, latency_ms, created_at
FROM dr_copilot_message
WHERE tenant_id = $1 AND session_id = $2
ORDER BY seq ASC`

// ListMessages returns a session's full transcript ordered by seq.
func (s *Store) ListMessages(ctx context.Context, db repository.DBTX, tenantID, sessionID string) ([]Message, error) {
	rows, err := db.Query(ctx, listMessagesSQL, tenantID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("copilot: listing messages: %w", err)
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
		return nil, fmt.Errorf("copilot: reading messages: %w", err)
	}
	return out, nil
}

const pruneSessionsSQL = `
DELETE FROM dr_copilot_session
WHERE updated_at < $1`

// PruneSessionsOlderThan deletes sessions (and, via ON DELETE CASCADE, their
// messages) last touched before cutoff. It is invoked by the background loop on
// the system path (RLS bypassed) so it sweeps every tenant. Returns the number
// of sessions removed.
func (s *Store) PruneSessionsOlderThan(ctx context.Context, db repository.DBTX, cutoff time.Time) (int64, error) {
	tag, err := db.Exec(ctx, pruneSessionsSQL, cutoff)
	if err != nil {
		return 0, fmt.Errorf("copilot: pruning sessions: %w", err)
	}
	return tag.RowsAffected(), nil
}

func scanMessage(rows pgx.Rows) (Message, error) {
	var m Message
	var toolName, toolCallID *string
	var toolCalls []byte
	var proposed []byte
	if err := rows.Scan(
		&m.ID, &m.SessionID, &m.TenantID, &m.Seq, &m.Role, &m.Content,
		&toolName, &toolCallID, &toolCalls, &proposed, &m.LatencyMS, &m.CreatedAt,
	); err != nil {
		return Message{}, fmt.Errorf("copilot: scanning message: %w", err)
	}
	if toolName != nil {
		m.ToolName = *toolName
	}
	if toolCallID != nil {
		m.ToolCallID = *toolCallID
	}
	if len(toolCalls) > 0 {
		if err := json.Unmarshal(toolCalls, &m.ToolCalls); err != nil {
			return Message{}, fmt.Errorf("copilot: unmarshalling tool_calls: %w", err)
		}
	}
	if len(proposed) > 0 {
		var pa ProposedAction
		if err := json.Unmarshal(proposed, &pa); err != nil {
			return Message{}, fmt.Errorf("copilot: unmarshalling proposed_action: %w", err)
		}
		m.ProposedAction = &pa
	}
	return m, nil
}

func nullableString(v string) any {
	if v == "" {
		return nil
	}
	return v
}
