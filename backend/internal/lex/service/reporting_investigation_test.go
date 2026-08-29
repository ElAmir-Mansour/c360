package service

import (
	"testing"

	"github.com/clario360/platform/internal/lex/model"
)

func TestInvestigationSLAReportExcludesPendingFromComplianceRate(t *testing.T) {
	got := investigationSLAReport([]model.CountBucket{
		{Key: "on_time", Count: 3},
		{Key: "breached", Count: 1},
		{Key: "pending", Count: 7},
	})
	if got.OnTime != 3 || got.Breached != 1 || got.Pending != 7 || got.ComplianceRatePct != 75 {
		t.Fatalf("investigationSLAReport = %+v", got)
	}
}

func TestCompleteInvestigationStatusBucketsEmitsAllFSMStatesInOrder(t *testing.T) {
	got := completeInvestigationStatusBuckets([]model.CountBucket{
		{Key: "closed", Count: 2},
		{Key: "registered", Count: 4},
	})
	wantKeys := []string{
		"registered", "in_progress", "results_recorded", "pending_approval",
		"approved", "rejected", "closed", "cancelled",
	}
	if len(got) != len(wantKeys) {
		t.Fatalf("len = %d, want %d", len(got), len(wantKeys))
	}
	for i, key := range wantKeys {
		if got[i].Key != key {
			t.Fatalf("bucket[%d].Key = %q, want %q", i, got[i].Key, key)
		}
	}
	if got[0].Count != 4 || got[6].Count != 2 || got[1].Count != 0 {
		t.Fatalf("buckets = %+v", got)
	}
}
