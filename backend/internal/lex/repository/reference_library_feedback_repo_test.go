package repository

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// TestReferenceLibraryFeedbackRepositoryInsert proves the ask-feedback insert binds
// the who/what/rating/comment/citations columns and defaults an empty citations
// payload to a JSON empty array (so the NOT NULL jsonb column is always satisfied).
func TestReferenceLibraryFeedbackRepositoryInsert(t *testing.T) {
	mock := newRefLibMock(t)
	repo := NewReferenceLibraryFeedbackRepository(mock, zerolog.Nop())

	tenant := uuid.New()
	user := uuid.New()
	citations := json.RawMessage(`[{"doc_id":"d1"}]`)

	mock.ExpectExec("INSERT INTO reference_library_ask_feedback").
		WithArgs(&tenant, &user, "هل يجوز؟", "up", "مفيد", citations).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	err := repo.Insert(context.Background(), model.ReferenceLibraryAskFeedbackEntry{
		TenantID:  &tenant,
		UserID:    &user,
		Question:  "هل يجوز؟",
		Rating:    "up",
		Comment:   "مفيد",
		Citations: citations,
	})
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestReferenceLibraryFeedbackRepositoryInsertEmptyCitations proves an absent
// citations payload is persisted as an empty JSON array (never NULL).
func TestReferenceLibraryFeedbackRepositoryInsertEmptyCitations(t *testing.T) {
	mock := newRefLibMock(t)
	repo := NewReferenceLibraryFeedbackRepository(mock, zerolog.Nop())

	mock.ExpectExec("INSERT INTO reference_library_ask_feedback").
		WithArgs((*uuid.UUID)(nil), (*uuid.UUID)(nil), "q", "down", "", json.RawMessage("[]")).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	err := repo.Insert(context.Background(), model.ReferenceLibraryAskFeedbackEntry{
		Question: "q",
		Rating:   "down",
	})
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestReferenceLibraryFeedbackRepositoryNilSafe proves a nil repository is a no-op
// (a deployment that has not migrated the feedback table degrades to log-only).
func TestReferenceLibraryFeedbackRepositoryNilSafe(t *testing.T) {
	var repo *ReferenceLibraryFeedbackRepository
	if err := repo.Insert(context.Background(), model.ReferenceLibraryAskFeedbackEntry{Rating: "up"}); err != nil {
		t.Fatalf("nil repo Insert should be a no-op, got %v", err)
	}
}
