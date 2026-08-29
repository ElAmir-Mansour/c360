package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestLegalHoldSubjectTypeValid(t *testing.T) {
	t.Parallel()
	cases := []struct {
		subject model.LegalHoldSubjectType
		want    bool
	}{
		{model.LegalHoldSubjectContract, true},
		{model.LegalHoldSubjectMatter, true},
		{model.LegalHoldSubjectDocument, true},
		{model.LegalHoldSubjectType("file"), false},
		{model.LegalHoldSubjectType(""), false},
	}
	for _, tc := range cases {
		if got := tc.subject.Valid(); got != tc.want {
			t.Fatalf("Valid(%q) = %v, want %v", tc.subject, got, tc.want)
		}
	}
}

func TestValidateApplyLegalHold(t *testing.T) {
	t.Parallel()
	subjectID := uuid.New()
	cases := []struct {
		name      string
		req       dto.ApplyLegalHoldRequest
		wantValid bool
		wantField string
	}{
		{
			name:      "valid",
			req:       dto.ApplyLegalHoldRequest{SubjectType: model.LegalHoldSubjectContract, SubjectID: subjectID, Reason: "litigation"},
			wantValid: true,
		},
		{
			name:      "invalid subject type",
			req:       dto.ApplyLegalHoldRequest{SubjectType: model.LegalHoldSubjectType("blob"), SubjectID: subjectID, Reason: "x"},
			wantField: "subject_type",
		},
		{
			name:      "missing subject id",
			req:       dto.ApplyLegalHoldRequest{SubjectType: model.LegalHoldSubjectDocument, Reason: "x"},
			wantField: "subject_id",
		},
		{
			name:      "missing reason",
			req:       dto.ApplyLegalHoldRequest{SubjectType: model.LegalHoldSubjectMatter, SubjectID: subjectID},
			wantField: "reason",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.req.Normalize()
			err := validateApplyLegalHold(tc.req)
			if tc.wantValid {
				if err != nil {
					t.Fatalf("validateApplyLegalHold() = %v, want nil", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("validateApplyLegalHold() = nil, want validation error")
			}
			var appErr *apperrors.AppError
			if !errors.As(err, &appErr) || appErr.Code != "VALIDATION_ERROR" {
				t.Fatalf("error = %v, want VALIDATION_ERROR AppError", err)
			}
			if _, ok := appErr.Fields[tc.wantField]; !ok {
				t.Fatalf("validation fields = %v, want field %q", appErr.Fields, tc.wantField)
			}
		})
	}
}

func TestApplyLegalHoldRequestNormalize(t *testing.T) {
	t.Parallel()
	req := dto.ApplyLegalHoldRequest{
		SubjectType: model.LegalHoldSubjectType("  contract "),
		Reason:      "  preserve  ",
		Reference:   "  CASE-1 ",
		Custodian:   "  GC ",
		Notes:       "  note ",
	}
	req.Normalize()
	if req.SubjectType != model.LegalHoldSubjectContract {
		t.Fatalf("subject_type = %q, want contract", req.SubjectType)
	}
	if req.Reason != "preserve" || req.Reference != "CASE-1" || req.Custodian != "GC" || req.Notes != "note" {
		t.Fatalf("normalize did not trim fields: %+v", req)
	}
	if req.Metadata == nil {
		t.Fatalf("normalize should initialize metadata to a non-nil map")
	}
}

func TestLegalHoldEnforcementError(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	err := legalHoldEnforcementError(model.LegalHoldSubjectContract, id)
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want *apperrors.AppError", err)
	}
	if appErr.Code != "LEGAL_HOLD_ACTIVE" {
		t.Fatalf("code = %s, want LEGAL_HOLD_ACTIVE", appErr.Code)
	}
	if appErr.Status != 409 {
		t.Fatalf("status = %d, want 409", appErr.Status)
	}
}

// stubGuard is a test double for LegalHoldGuard.
type stubGuard struct {
	held   bool
	err    error
	called bool
}

func (g *stubGuard) EnsureSubjectMutable(_ context.Context, _ uuid.UUID, _ model.LegalHoldSubjectType, _ uuid.UUID) error {
	g.called = true
	if g.err != nil {
		return g.err
	}
	if g.held {
		return legalHoldEnforcementError(model.LegalHoldSubjectContract, uuid.New())
	}
	return nil
}

func TestEnsureMutable(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tenantID := uuid.New()
	subjectID := uuid.New()

	// Nil guard is always mutable (backward compatible) and is not called.
	if err := ensureMutable(ctx, nil, tenantID, model.LegalHoldSubjectContract, subjectID); err != nil {
		t.Fatalf("nil guard ensureMutable() = %v, want nil", err)
	}

	// Not held -> nil.
	notHeld := &stubGuard{held: false}
	if err := ensureMutable(ctx, notHeld, tenantID, model.LegalHoldSubjectContract, subjectID); err != nil {
		t.Fatalf("not-held ensureMutable() = %v, want nil", err)
	}
	if !notHeld.called {
		t.Fatalf("guard was not consulted")
	}

	// Held -> enforcement conflict.
	held := &stubGuard{held: true}
	err := ensureMutable(ctx, held, tenantID, model.LegalHoldSubjectContract, subjectID)
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) || appErr.Code != "LEGAL_HOLD_ACTIVE" {
		t.Fatalf("held ensureMutable() = %v, want LEGAL_HOLD_ACTIVE", err)
	}

	// Guard error propagates verbatim.
	boom := errors.New("db down")
	failing := &stubGuard{err: boom}
	if err := ensureMutable(ctx, failing, tenantID, model.LegalHoldSubjectContract, subjectID); !errors.Is(err, boom) {
		t.Fatalf("failing guard ensureMutable() = %v, want %v", err, boom)
	}
}
