package service

import (
	"testing"
	"time"

	"github.com/clario360/platform/internal/lex/model"
)

func TestBuildResolutionRateReportRoundingAndOrder(t *testing.T) {
	calculatedAt := time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC)

	report := buildResolutionRateReport([]model.ResolutionRateCategory{
		{Key: "contracts", Total: 8, Resolved: 6},  // 75
		{Key: "litigation", Total: 3, Resolved: 2}, // 66.67 -> 67
		{Key: "advisory", Total: 0, Resolved: 0},   // total 0 -> 0
		{Key: "requests", Total: 4, Resolved: 1},   // 25
	}, calculatedAt)

	if !report.CalculatedAt.Equal(calculatedAt) {
		t.Fatalf("CalculatedAt = %s, want %s", report.CalculatedAt, calculatedAt)
	}
	wantKeys := []string{"contracts", "litigation", "advisory", "requests"}
	if len(report.Categories) != len(wantKeys) {
		t.Fatalf("len(Categories) = %d, want %d", len(report.Categories), len(wantKeys))
	}
	for i, key := range wantKeys {
		if report.Categories[i].Key != key {
			t.Fatalf("Categories[%d].Key = %q, want %q (fixed order)", i, report.Categories[i].Key, key)
		}
	}
	wantRates := map[string]int{"contracts": 75, "litigation": 67, "advisory": 0, "requests": 25}
	for _, c := range report.Categories {
		if c.Rate != wantRates[c.Key] {
			t.Fatalf("Categories[%s].Rate = %d, want %d", c.Key, c.Rate, wantRates[c.Key])
		}
	}
}

func TestResolutionPctZeroTotalAndRounding(t *testing.T) {
	cases := []struct {
		resolved, total, want int
	}{
		{0, 0, 0},   // guard: total 0
		{5, 0, 0},   // guard: total 0 even with resolved
		{1, 3, 33},  // 33.33 -> 33
		{2, 3, 67},  // 66.67 -> 67
		{1, 2, 50},  // 50.0 -> 50
		{3, 3, 100}, // full
	}
	for _, c := range cases {
		if got := resolutionPct(c.resolved, c.total); got != c.want {
			t.Fatalf("resolutionPct(%d, %d) = %d, want %d", c.resolved, c.total, got, c.want)
		}
	}
}
