package repository

import (
	"testing"
	"time"
)

func TestContractDatePtrPreservesMilestoneTime(t *testing.T) {
	input := time.Date(2026, time.July, 31, 16, 45, 30, 123, time.FixedZone("AST", 3*60*60))
	got := datePtr(&input)
	if got == nil {
		t.Fatal("datePtr returned nil")
	}
	if !got.Equal(input) {
		t.Fatalf("datePtr changed instant: got %s want %s", got, input)
	}
	if got.Hour() == 0 || got.Minute() != 45 {
		t.Fatalf("datePtr dropped time component: %s", got)
	}
	if got.Location() != time.UTC {
		t.Fatalf("datePtr location = %s, want UTC", got.Location())
	}
}
