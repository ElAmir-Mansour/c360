package copilot

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

const storeTenant = "11111111-0000-0000-0000-000000000001"

func newStoreMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func TestStore_CreateSession(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	now := time.Now()
	s := NewStore()

	mock.ExpectQuery(`INSERT INTO dr_copilot_session`).
		WithArgs(storeTenant, "user-1", "DR Copilot session", "anthropic", "claude").
		WillReturnRows(pgxmock.NewRows([]string{"id", "message_count", "created_at", "updated_at"}).
			AddRow("sess-1", 0, now, now))

	sess := &Session{TenantID: storeTenant, UserID: "user-1", Provider: "anthropic", Model: "claude"}
	if err := s.CreateSession(context.Background(), mock, sess); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if sess.ID != "sess-1" || sess.MessageCount != 0 {
		t.Fatalf("session not populated: %+v", sess)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestStore_GetSessionNotFound(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	s := NewStore()
	mock.ExpectQuery(`SELECT id, tenant_id, user_id, title, provider, model, message_count, created_at, updated_at\s+FROM dr_copilot_session`).
		WithArgs(storeTenant, "ghost").
		WillReturnError(pgx.ErrNoRows)

	_, err := s.GetSession(context.Background(), mock, storeTenant, "ghost")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestStore_AppendMessageWithToolCallsAndProposedAction(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	now := time.Now()
	s := NewStore()

	m := &Message{
		SessionID: "sess-1",
		TenantID:  storeTenant,
		Seq:       2,
		Role:      RoleAssistant,
		Content:   "answer",
		ToolCalls: []ToolCallRecord{{ID: "c1", Name: toolBlastRadius, Success: true, ResultSummary: "ok"}},
		ProposedAction: &ProposedAction{
			Kind:             "failover",
			RequiresApproval: true,
			APICall:          APICall{Method: "POST", Path: "/api/v1/dr/failover-runs"},
		},
		LatencyMS: 123,
	}

	// tool_calls and proposed_action are passed as JSON bytes; match with
	// pgxmock.AnyArg() since exact byte ordering is an implementation detail.
	mock.ExpectQuery(`INSERT INTO dr_copilot_message`).
		WithArgs("sess-1", storeTenant, 2, RoleAssistant, "answer",
			nil, nil, pgxmock.AnyArg(), pgxmock.AnyArg(), 123).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).AddRow("msg-1", now))

	if err := s.AppendMessage(context.Background(), mock, m); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}
	if m.ID != "msg-1" {
		t.Fatalf("message id not populated: %+v", m)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestStore_AppendToolMessageSetsNames(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	now := time.Now()
	s := NewStore()

	m := &Message{
		SessionID:  "sess-1",
		TenantID:   storeTenant,
		Seq:        1,
		Role:       RoleTool,
		Content:    "tool summary",
		ToolName:   toolDRStateSummary,
		ToolCallID: "c1",
	}
	mock.ExpectQuery(`INSERT INTO dr_copilot_message`).
		WithArgs("sess-1", storeTenant, 1, RoleTool, "tool summary",
			toolDRStateSummary, "c1", pgxmock.AnyArg(), nil, 0).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).AddRow("msg-2", now))

	if err := s.AppendMessage(context.Background(), mock, m); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestStore_TouchSession(t *testing.T) {
	t.Parallel()
	s := NewStore()

	t.Run("ok", func(t *testing.T) {
		t.Parallel()
		mock := newStoreMock(t)
		mock.ExpectExec(`UPDATE dr_copilot_session`).
			WithArgs(storeTenant, "sess-1", 4).
			WillReturnResult(pgxmock.NewResult("UPDATE", 1))
		if err := s.TouchSession(context.Background(), mock, storeTenant, "sess-1", 4); err != nil {
			t.Fatalf("TouchSession: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet: %v", err)
		}
	})

	t.Run("missing maps to ErrNotFound", func(t *testing.T) {
		t.Parallel()
		mock := newStoreMock(t)
		mock.ExpectExec(`UPDATE dr_copilot_session`).
			WithArgs(storeTenant, "ghost", 4).
			WillReturnResult(pgxmock.NewResult("UPDATE", 0))
		if err := s.TouchSession(context.Background(), mock, storeTenant, "ghost", 4); !errors.Is(err, ErrNotFound) {
			t.Fatalf("expected ErrNotFound, got %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet: %v", err)
		}
	})
}

func TestStore_ListMessagesRoundTripsJSON(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	now := time.Now()
	s := NewStore()

	toolCallsJSON := []byte(`[{"id":"c1","name":"blast_radius","success":true,"result_summary":"ok","latency_ms":0}]`)
	proposedJSON := []byte(`{"kind":"failover","summary":"x","requires_approval":true,"api_call":{"method":"POST","path":"/api/v1/dr/failover-runs"}}`)

	rows := pgxmock.NewRows([]string{
		"id", "session_id", "tenant_id", "seq", "role", "content",
		"tool_name", "tool_call_id", "tool_calls", "proposed_action", "latency_ms", "created_at",
	}).
		AddRow("m0", "sess-1", storeTenant, 0, RoleUser, "question",
			nil, nil, []byte(`[]`), nil, 0, now).
		AddRow("m1", "sess-1", storeTenant, 1, RoleTool, "summary",
			strPtr(toolBlastRadius), strPtr("c1"), []byte(`[]`), nil, 0, now).
		AddRow("m2", "sess-1", storeTenant, 2, RoleAssistant, "answer",
			nil, nil, toolCallsJSON, proposedJSON, 42, now)

	mock.ExpectQuery(`SELECT id, session_id, tenant_id, seq, role, content, tool_name, tool_call_id,\s+tool_calls, proposed_action, latency_ms, created_at\s+FROM dr_copilot_message`).
		WithArgs(storeTenant, "sess-1").
		WillReturnRows(rows)

	msgs, err := s.ListMessages(context.Background(), mock, storeTenant, "sess-1")
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 3 {
		t.Fatalf("expected 3 messages, got %d", len(msgs))
	}
	if msgs[1].ToolName != toolBlastRadius || msgs[1].ToolCallID != "c1" {
		t.Fatalf("tool row names not decoded: %+v", msgs[1])
	}
	if len(msgs[2].ToolCalls) != 1 || msgs[2].ToolCalls[0].Name != toolBlastRadius {
		t.Fatalf("tool_calls not decoded: %+v", msgs[2].ToolCalls)
	}
	if msgs[2].ProposedAction == nil || !msgs[2].ProposedAction.RequiresApproval {
		t.Fatalf("proposed_action not decoded: %+v", msgs[2].ProposedAction)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestStore_PruneSessionsOlderThan(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	s := NewStore()
	cutoff := time.Now().Add(-90 * 24 * time.Hour)

	mock.ExpectExec(`DELETE FROM dr_copilot_session`).
		WithArgs(cutoff).
		WillReturnResult(pgxmock.NewResult("DELETE", 7))

	n, err := s.PruneSessionsOlderThan(context.Background(), mock, cutoff)
	if err != nil {
		t.Fatalf("PruneSessionsOlderThan: %v", err)
	}
	if n != 7 {
		t.Fatalf("expected 7 pruned, got %d", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func strPtr(s string) *string { return &s }
