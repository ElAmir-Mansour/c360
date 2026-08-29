package repository

import (
	"context"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// ReferenceLibraryFeedbackRepository persists the answer-quality feedback trail
// for the GLOBAL reference library's Second-Brain /ask surface
// (reference_library_ask_feedback). It is write-mostly (Insert): a thumbs up/down
// plus an optional comment and the citations the graded answer cited. It takes a
// Queryer (satisfied by *pgxpool.Pool AND by pgxmock) so the insert SQL is
// unit-testable without a live database.
//
// The repository is NIL-SAFE: a nil *ReferenceLibraryFeedbackRepository makes
// Insert a no-op returning nil, so a deployment that has not (yet) migrated the
// feedback table degrades to structured-log-only feedback capture rather than
// failing the request path (which returns 204 either way).
type ReferenceLibraryFeedbackRepository struct {
	db     Queryer
	logger zerolog.Logger
}

func NewReferenceLibraryFeedbackRepository(db Queryer, logger zerolog.Logger) *ReferenceLibraryFeedbackRepository {
	return &ReferenceLibraryFeedbackRepository{db: db, logger: logger}
}

// Insert appends one feedback row. It is best-effort by contract: the caller runs
// it off the request's critical path and treats an error as non-fatal (the POST
// returns 204 regardless), so a transient feedback-write failure never blocks the
// reader.
func (r *ReferenceLibraryFeedbackRepository) Insert(ctx context.Context, e model.ReferenceLibraryAskFeedbackEntry) error {
	if r == nil || r.db == nil {
		return nil
	}
	citations := e.Citations
	if len(citations) == 0 {
		citations = []byte("[]")
	}
	const q = `
INSERT INTO reference_library_ask_feedback (
    tenant_id, user_id, question, rating, comment, citations
) VALUES (
    $1, $2, $3, $4, $5, $6
)`
	_, err := r.db.Exec(ctx, q,
		e.TenantID, e.UserID, e.Question, e.Rating, e.Comment, citations,
	)
	return err
}
