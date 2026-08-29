package service

import (
	"testing"
	"time"

	"github.com/clario360/platform/internal/workflow/model"
)

func TestValidateTaskLateJustificationUsesDeadlineAndRequiresExplanation(t *testing.T) {
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	deadline := now.Add(-time.Second)
	task := &model.HumanTask{SLADeadline: &deadline, Metadata: map[string]interface{}{"subject_type": "legal_case"}}

	if _, _, err := validateTaskLateJustification(task, nil, now); err == nil {
		t.Fatal("late task without justification must be rejected")
	}
	raw := "  External court filing delayed the review.  "
	justification, role, err := validateTaskLateJustification(task, &raw, now)
	if err != nil {
		t.Fatalf("late task with justification: %v", err)
	}
	if justification != "External court filing delayed the review." {
		t.Fatalf("justification = %q", justification)
	}
	if role != "legal-cases-manager" {
		t.Fatalf("manager role = %q, want legal-cases-manager", role)
	}
}

func TestValidateTaskLateJustificationDoesNotTrustBreachedFlag(t *testing.T) {
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	deadline := now.Add(time.Second)
	task := &model.HumanTask{SLADeadline: &deadline, SLABreached: true}
	raw := "not retained for an on-time completion"

	justification, role, err := validateTaskLateJustification(task, &raw, now)
	if err != nil || justification != "" || role != "" {
		t.Fatalf("on-time result = (%q, %q, %v), want empty", justification, role, err)
	}
}
