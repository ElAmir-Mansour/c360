package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func TestEvaluateAttachmentPolicyHonorsMaxAttachmentCount(t *testing.T) {
	policy := &model.AttachmentPolicy{
		ID:                 uuid.New(),
		RequestType:        "contract_review",
		MinAttachmentCount: 1,
		MaxAttachmentCount: 2,
		Slots: []model.AttachmentSlot{
			{Key: "draft", Required: true},
		},
	}

	eval := evaluateAttachmentPolicy(policy, []string{"draft"}, 3, time.Unix(123, 0).UTC())
	if eval.Complete {
		t.Fatalf("Complete = true, want false when provided count exceeds max")
	}
	if eval.CountSatisfied {
		t.Fatalf("CountSatisfied = true, want false when count exceeds max")
	}
	if !eval.CountExceeded {
		t.Fatalf("CountExceeded = false, want true")
	}
	if eval.MaxAllowedCount != 2 {
		t.Fatalf("MaxAllowedCount = %d, want 2", eval.MaxAllowedCount)
	}
}

func TestEvaluateAttachmentPolicyZeroMaxIsUnbounded(t *testing.T) {
	policy := &model.AttachmentPolicy{
		ID:                 uuid.New(),
		ServiceCode:        "GENERAL_LEGAL_REQUEST",
		MinAttachmentCount: 1,
		MaxAttachmentCount: 0,
		Slots: []model.AttachmentSlot{
			{Key: " Supporting_Doc ", Required: true},
		},
	}

	eval := evaluateAttachmentPolicy(policy, []string{"supporting_doc"}, 12, time.Unix(123, 0).UTC())
	if !eval.Complete {
		t.Fatalf("Complete = false, want true for unbounded max with required slot present")
	}
	if eval.CountExceeded {
		t.Fatalf("CountExceeded = true, want false for max=0")
	}
}

func TestValidateAttachmentPolicyCountsRejectsInvertedBounds(t *testing.T) {
	err := validateAttachmentPolicyCounts(3, 2)
	if err == nil {
		t.Fatalf("validateAttachmentPolicyCounts() = nil, want error")
	}
}
