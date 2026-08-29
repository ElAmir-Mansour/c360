package service

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
)

// newClassificationServiceForValidation builds a service whose DB/repo are nil.
// It is only safe to exercise the pure-validation / early-return branches of
// Reorder and Bulk that return before any store or transaction access.
func newClassificationServiceForValidation() *CaseClassificationService {
	return &CaseClassificationService{
		publisher: noopPublisher{},
		logger:    zerolog.Nop(),
	}
}

func TestBulkCaseClassificationsRejectsUnknownAction(t *testing.T) {
	s := newClassificationServiceForValidation()
	_, err := s.Bulk(context.Background(), uuid.New(), uuid.New(), dto.BulkCaseClassificationsRequest{
		Action: "purge",
		IDs:    []uuid.UUID{uuid.New()},
	})
	if err == nil {
		t.Fatal("expected validation error for unknown action, got nil")
	}
	if got := apperrors.HTTPStatus(err); got != http.StatusUnprocessableEntity {
		t.Fatalf("HTTPStatus = %d, want 422 for unknown action", got)
	}
}

func TestBulkCaseClassificationsEmptyIDsIsNoop(t *testing.T) {
	s := newClassificationServiceForValidation()
	for _, action := range []string{"activate", "deactivate"} {
		res, err := s.Bulk(context.Background(), uuid.New(), uuid.New(), dto.BulkCaseClassificationsRequest{
			Action: action,
			IDs:    nil,
		})
		if err != nil {
			t.Fatalf("Bulk(%s, empty) returned error: %v", action, err)
		}
		if res.Updated != 0 {
			t.Fatalf("Bulk(%s, empty).Updated = %d, want 0", action, res.Updated)
		}
	}
}

func TestReorderCaseClassificationsEmptyIDsIsNoop(t *testing.T) {
	s := newClassificationServiceForValidation()
	res, err := s.Reorder(context.Background(), uuid.New(), uuid.New(), dto.ReorderCaseClassificationsRequest{
		ParentID:   nil,
		OrderedIDs: nil,
	})
	if err != nil {
		t.Fatalf("Reorder(empty) returned error: %v", err)
	}
	if res.Updated != 0 {
		t.Fatalf("Reorder(empty).Updated = %d, want 0", res.Updated)
	}
}
