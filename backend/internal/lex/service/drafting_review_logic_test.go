package service

import (
	"testing"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// TestDraftReviewStatusForDecision covers the engine-decision -> terminal
// review-status mapping (Feature 4) including aliases and the invalid case.
func TestDraftReviewStatusForDecision(t *testing.T) {
	cases := []struct {
		decision string
		want     string
		wantErr  bool
	}{
		{"approve", model.DraftReviewStatusApproved, false},
		{"approved", model.DraftReviewStatusApproved, false},
		{"reject", model.DraftReviewStatusRejected, false},
		{"rejected", model.DraftReviewStatusRejected, false},
		{"request_changes", model.DraftReviewStatusChangesRequested, false},
		{"changes_requested", model.DraftReviewStatusChangesRequested, false},
		{"", "", true},
		{"maybe", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.decision, func(t *testing.T) {
			got, err := draftReviewStatusForDecision(tc.decision)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for %q", tc.decision)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for %q: %v", tc.decision, err)
			}
			if got != tc.want {
				t.Fatalf("decision %q: got %q want %q", tc.decision, got, tc.want)
			}
		})
	}
}

// TestBuildDraftReviewFormSchema verifies the default decision/notes pair is
// always present, additional fields are appended, and reserved/duplicate names
// are rejected.
func TestBuildDraftReviewFormSchema(t *testing.T) {
	t.Run("defaults only", func(t *testing.T) {
		schema, err := buildDraftReviewFormSchema(nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(schema) != 2 {
			t.Fatalf("want 2 default fields, got %d", len(schema))
		}
		if schema[0].Name != "decision" || !schema[0].Required {
			t.Fatalf("first field must be required decision, got %+v", schema[0])
		}
		if schema[1].Name != "notes" || schema[1].Required {
			t.Fatalf("second field must be optional notes, got %+v", schema[1])
		}
	})

	t.Run("appends custom field", func(t *testing.T) {
		schema, err := buildDraftReviewFormSchema([]dto.ApprovalFormFieldRequest{
			{Name: "risk_rating", Type: "select", Label: "Risk", Required: true, Options: []string{"low", "high"}},
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(schema) != 3 {
			t.Fatalf("want 3 fields, got %d", len(schema))
		}
		if schema[2].Name != "risk_rating" {
			t.Fatalf("custom field not appended, got %+v", schema[2])
		}
	})

	t.Run("rejects reserved name", func(t *testing.T) {
		_, err := buildDraftReviewFormSchema([]dto.ApprovalFormFieldRequest{
			{Name: "decision", Type: "text", Label: "Dup"},
		})
		if err == nil {
			t.Fatal("expected error for reserved field name 'decision'")
		}
	})

	t.Run("rejects duplicate custom name", func(t *testing.T) {
		_, err := buildDraftReviewFormSchema([]dto.ApprovalFormFieldRequest{
			{Name: "extra", Type: "text", Label: "A"},
			{Name: "extra", Type: "text", Label: "B"},
		})
		if err == nil {
			t.Fatal("expected error for duplicate custom field name")
		}
	})

	t.Run("rejects invalid visible_when", func(t *testing.T) {
		_, err := buildDraftReviewFormSchema([]dto.ApprovalFormFieldRequest{
			{Name: "extra", Type: "text", Label: "A", VisibleWhen: "(decision == "},
		})
		if err == nil {
			t.Fatal("expected error for malformed visible_when expression")
		}
	})
}

// TestSubmitDraftForReviewRequestNormalize covers trimming and empty-role
// nilling on the request DTO.
func TestSubmitDraftForReviewRequestNormalize(t *testing.T) {
	role := "   "
	req := dto.SubmitDraftForReviewRequest{
		Title:        "  NDA draft  ",
		DraftKind:    "  contract ",
		AssigneeRole: &role,
	}
	req.Normalize()
	if req.Title != "NDA draft" {
		t.Fatalf("title not trimmed: %q", req.Title)
	}
	if req.DraftKind != "contract" {
		t.Fatalf("draft_kind not trimmed: %q", req.DraftKind)
	}
	if req.AssigneeRole != nil {
		t.Fatalf("blank assignee_role must be nilled, got %q", *req.AssigneeRole)
	}
	if req.Content == nil {
		t.Fatal("content must be non-nil after normalize")
	}

	kept := "  legal  "
	req2 := dto.SubmitDraftForReviewRequest{Title: "x", AssigneeRole: &kept}
	req2.Normalize()
	if req2.AssigneeRole == nil || *req2.AssigneeRole != "legal" {
		t.Fatalf("non-blank assignee_role must be trimmed and kept, got %v", req2.AssigneeRole)
	}
}
