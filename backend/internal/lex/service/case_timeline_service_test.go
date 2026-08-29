package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// TestComputeOpenDelayDays_SumsOpenAndResolvedWindows verifies the running
// open-delay-day total (used by GetTimeline and mirrored by the cross-matter
// summary SQL #15): each window contributes floor(duration in days), still-open
// windows run to now, and negative/sub-day windows contribute zero.
func TestComputeOpenDelayDays_SumsOpenAndResolvedWindows(t *testing.T) {
	now := time.Date(2026, 6, 25, 12, 0, 0, 0, time.UTC)
	resolved := now.AddDate(0, 0, -2) // 3-day window opened 5 days ago, resolved 2 days ago
	events := []model.LegalCaseDelayEvent{
		{
			OpenedAt:   now.AddDate(0, 0, -10), // still open: 10 days
			ResolvedAt: nil,
		},
		{
			OpenedAt:   now.AddDate(0, 0, -5),
			ResolvedAt: &resolved, // resolved window: 3 days
		},
		{
			OpenedAt:   now.Add(2 * time.Hour), // future/sub-day: contributes 0
			ResolvedAt: nil,
		},
	}
	got := computeOpenDelayDays(events, now)
	if got != 13 {
		t.Fatalf("computeOpenDelayDays = %d, want 13", got)
	}
}

func TestComputeOpenDelayDays_Empty(t *testing.T) {
	if got := computeOpenDelayDays(nil, time.Now()); got != 0 {
		t.Fatalf("computeOpenDelayDays(nil) = %d, want 0", got)
	}
}

// TestUpdateDelayEventRequest_Normalize confirms category is lower-cased/trimmed
// and reason is trimmed in place, while nil pointers stay nil (#13).
func TestUpdateDelayEventRequest_Normalize(t *testing.T) {
	cat := model.DelayCategory("  COURT ")
	reason := "  needs court date  "
	req := dto.UpdateDelayEventRequest{Category: &cat, Reason: &reason}
	req.Normalize()
	if req.Category == nil || *req.Category != model.DelayCategoryCourt {
		t.Fatalf("category = %v, want %q", req.Category, model.DelayCategoryCourt)
	}
	if req.Reason == nil || *req.Reason != "needs court date" {
		t.Fatalf("reason = %v, want %q", req.Reason, "needs court date")
	}

	empty := dto.UpdateDelayEventRequest{}
	empty.Normalize()
	if empty.Category != nil || empty.Reason != nil {
		t.Fatalf("nil pointers must stay nil, got category=%v reason=%v", empty.Category, empty.Reason)
	}
}

// TestUpdateDelayEventRequest_NormalizeInvalidCategory confirms Normalize does not
// coerce an unknown category into a valid one (the service still rejects it).
func TestUpdateDelayEventRequest_NormalizeInvalidCategory(t *testing.T) {
	cat := model.DelayCategory("Vendor")
	req := dto.UpdateDelayEventRequest{Category: &cat}
	req.Normalize()
	if req.Category == nil || req.Category.Valid() {
		t.Fatalf("unknown category should normalize to an invalid value, got %v valid=%v", req.Category, req.Category.Valid())
	}
}

// TestCreateDeadlineObligationRequest_Normalize confirms kind defaults to
// "deadline", and kind/title/owner_name are trimmed/lower-cased (#10/#11).
func TestCreateDeadlineObligationRequest_Normalize(t *testing.T) {
	req := dto.CreateDeadlineObligationRequest{
		Kind:      "  Hearing ",
		Title:     "  Hearing 1  ",
		OwnerName: "  Sara  ",
	}
	req.Normalize()
	if req.Kind != "hearing" {
		t.Fatalf("kind = %q, want %q", req.Kind, "hearing")
	}
	if req.Title != "Hearing 1" {
		t.Fatalf("title = %q, want %q", req.Title, "Hearing 1")
	}
	if req.OwnerName != "Sara" {
		t.Fatalf("owner_name = %q, want %q", req.OwnerName, "Sara")
	}

	empty := dto.CreateDeadlineObligationRequest{}
	empty.Normalize()
	if empty.Kind != "deadline" {
		t.Fatalf("empty kind should default to %q, got %q", "deadline", empty.Kind)
	}
}

// TestDelayCategoryValid guards the validation used by the new PATCH path (#13).
func TestDelayCategoryValid(t *testing.T) {
	valid := []model.DelayCategory{
		model.DelayCategoryCourt, model.DelayCategoryGovernment,
		model.DelayCategoryDepartment, model.DelayCategoryExpert,
	}
	for _, c := range valid {
		if !c.Valid() {
			t.Fatalf("category %q should be valid", c)
		}
	}
	for _, c := range []model.DelayCategory{"", "vendor", "Court"} {
		if c.Valid() {
			t.Fatalf("category %q should be invalid", c)
		}
	}
}

// TestMatterTimelineSummaryFilters_ZeroValues documents the safe defaults the
// handler relies on for the cross-matter summary (#15): no on_hold filter, no
// min-open-delay floor.
func TestMatterTimelineSummaryFilters_ZeroValues(t *testing.T) {
	var f model.MatterTimelineSummaryFilters
	if f.OnHold != nil {
		t.Fatalf("OnHold should default to nil (no filter)")
	}
	if f.MinOpenDelayDays != 0 {
		t.Fatalf("MinOpenDelayDays should default to 0")
	}
	// A summary row carries a matter id; sanity check the struct is usable.
	row := model.MatterTimelineSummary{MatterID: uuid.New(), OpenDelayDays: 5}
	if row.OpenDelayDays != 5 {
		t.Fatalf("summary OpenDelayDays = %d, want 5", row.OpenDelayDays)
	}
}
