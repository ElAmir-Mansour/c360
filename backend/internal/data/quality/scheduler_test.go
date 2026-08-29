package quality

import (
	"testing"
	"time"

	"github.com/clario360/platform/internal/data/model"
)

func TestQualityRuleDueHonorsCronSchedule(t *testing.T) {
	lastRun := time.Date(2026, 6, 27, 17, 30, 0, 0, time.UTC)
	schedule := "0 * * * *"
	rule := &model.QualityRule{Schedule: &schedule, LastRunAt: &lastRun}

	due, err := qualityRuleDue(rule, time.Date(2026, 6, 27, 17, 45, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("qualityRuleDue: %v", err)
	}
	if due {
		t.Fatal("qualityRuleDue before next cron fire = true, want false")
	}

	due, err = qualityRuleDue(rule, time.Date(2026, 6, 27, 18, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("qualityRuleDue: %v", err)
	}
	if !due {
		t.Fatal("qualityRuleDue at next cron fire = false, want true")
	}
}

func TestQualityRuleDueRunsNeverExecutedScheduledRule(t *testing.T) {
	schedule := "15 */6 * * *"
	rule := &model.QualityRule{Schedule: &schedule}

	due, err := qualityRuleDue(rule, time.Date(2026, 6, 27, 17, 45, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("qualityRuleDue: %v", err)
	}
	if !due {
		t.Fatal("qualityRuleDue for never-run scheduled rule = false, want true")
	}
}

func TestQualityRuleDueSkipsUnscheduledRule(t *testing.T) {
	rule := &model.QualityRule{}

	due, err := qualityRuleDue(rule, time.Date(2026, 6, 27, 17, 45, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("qualityRuleDue: %v", err)
	}
	if due {
		t.Fatal("qualityRuleDue for unscheduled rule = true, want false")
	}
}
