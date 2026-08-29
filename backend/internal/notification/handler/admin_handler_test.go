package handler

import (
	"testing"
	"time"

	"github.com/clario360/platform/internal/notification/model"
)

// TestNotifTypeAndCategoryMapping asserts the short frontend type name resolves
// to the correct backend NotificationType AND that the type then classifies into
// the expected category — the two mappings the test-send endpoint chains
// together.
func TestNotifTypeAndCategoryMapping(t *testing.T) {
	tests := []struct {
		short        string
		wantType     model.NotificationType
		wantCategory string
	}{
		{"alert", model.NotifAlertCreated, model.CategorySecurity},
		{"task", model.NotifTaskAssigned, model.CategoryWorkflow},
		{"approval", model.NotifRemediationApproval, model.CategoryWorkflow},
		{"system", model.NotifSystemMaintenance, model.CategorySystem},
		{"mention", model.NotifActionItemAssigned, model.CategoryGovernance},
		{"deadline", model.NotifTaskOverdue, model.CategoryWorkflow},
		{"completion", model.NotifWorkflowCompleted, model.CategoryWorkflow},
		{"error", model.NotifPipelineFailed, model.CategoryData},
		{"report", model.NotifAnalysisReady, model.CategoryLegal},
		{"unknown-falls-back", model.NotifSystemMaintenance, model.CategorySystem},
	}
	for _, tt := range tests {
		t.Run(tt.short, func(t *testing.T) {
			gotType := notifTypeFromShort(tt.short)
			if gotType != tt.wantType {
				t.Fatalf("notifTypeFromShort(%q) = %q, want %q", tt.short, gotType, tt.wantType)
			}
			if gotCat := categoryFromType(gotType); gotCat != tt.wantCategory {
				t.Fatalf("categoryFromType(%q) = %q, want %q", gotType, gotCat, tt.wantCategory)
			}
		})
	}
}

// TestParsePeriod asserts the delivery-stats window parser maps known labels to
// their durations and defaults unknown/empty input to 7 days.
func TestParsePeriod(t *testing.T) {
	tests := []struct {
		in        string
		wantDur   time.Duration
		wantLabel string
	}{
		{"30d", 30 * 24 * time.Hour, "30d"},
		{"90d", 90 * 24 * time.Hour, "90d"},
		{"7d", 7 * 24 * time.Hour, "7d"},
		{"", 7 * 24 * time.Hour, "7d"},
		{"garbage", 7 * 24 * time.Hour, "7d"},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			dur, label := parsePeriod(tt.in)
			if dur != tt.wantDur || label != tt.wantLabel {
				t.Fatalf("parsePeriod(%q) = (%v, %q), want (%v, %q)", tt.in, dur, label, tt.wantDur, tt.wantLabel)
			}
		})
	}
}
