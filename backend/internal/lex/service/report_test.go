package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func TestBuildMatterReportJSONRollupsAndFilters(t *testing.T) {
	ownerID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	contractID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	generatedAt := time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC)
	dueAfter := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	dueBefore := time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC)
	status := model.MatterStatusOpen
	matterType := model.MatterTypeLitigation
	priority := model.LegalPriorityHigh
	department := "Legal"

	report := buildMatterReport([]model.Matter{
		{
			ID:           uuid.MustParse("33333333-3333-3333-3333-333333333333"),
			MatterNumber: "MAT-20260614-AAAA1111",
			Title:        "Vendor dispute",
			Type:         model.MatterTypeLitigation,
			Status:       model.MatterStatusOpen,
			Priority:     model.LegalPriorityHigh,
			OwnerUserID:  ownerID,
			OwnerName:    "Legal Owner",
			Department:   &department,
			OpenedAt:     generatedAt.AddDate(0, 0, -10),
			DueDate:      &dueBefore,
			CreatedAt:    generatedAt.AddDate(0, 0, -10),
		},
		{
			ID:           uuid.MustParse("44444444-4444-4444-4444-444444444444"),
			MatterNumber: "MAT-20260614-BBBB2222",
			Title:        "Employment advice",
			Type:         model.MatterTypeEmployment,
			Status:       model.MatterStatusClosed,
			Priority:     model.LegalPriorityLow,
			OwnerUserID:  ownerID,
			OwnerName:    "Legal Owner",
			OpenedAt:     generatedAt.AddDate(0, 0, -20),
			CreatedAt:    generatedAt.AddDate(0, 0, -20),
		},
	}, 5, model.MatterListFilters{
		Search:      "vendor",
		Status:      &status,
		Type:        &matterType,
		Priority:    &priority,
		OwnerUserID: &ownerID,
		ContractID:  &contractID,
		Department:  "Legal",
		DueAfter:    &dueAfter,
		DueBefore:   &dueBefore,
		Tag:         "ksa",
	}, generatedAt)

	if report.Total != 5 {
		t.Fatalf("Total = %d, want 5", report.Total)
	}
	if !report.GeneratedAt.Equal(generatedAt) {
		t.Fatalf("GeneratedAt = %s, want %s", report.GeneratedAt, generatedAt)
	}
	for key, want := range map[string]int{
		"open":   1,
		"closed": 1,
	} {
		if report.ByStatus[key] != want {
			t.Fatalf("ByStatus[%s] = %d, want %d", key, report.ByStatus[key], want)
		}
	}
	if report.ByType["litigation"] != 1 || report.ByType["employment"] != 1 {
		t.Fatalf("ByType = %+v, want litigation/employment counts", report.ByType)
	}
	if report.ByPriority["high"] != 1 || report.ByPriority["low"] != 1 {
		t.Fatalf("ByPriority = %+v, want high/low counts", report.ByPriority)
	}
	for key, want := range map[string]string{
		"search":        "vendor",
		"status":        "open",
		"type":          "litigation",
		"priority":      "high",
		"owner_user_id": ownerID.String(),
		"contract_id":   contractID.String(),
		"department":    "Legal",
		"due_after":     "2026-06-01",
		"due_before":    "2026-06-30",
		"tag":           "ksa",
	} {
		if report.Filters[key] != want {
			t.Fatalf("Filters[%s] = %q, want %q in %+v", key, report.Filters[key], want, report.Filters)
		}
	}
	if len(report.Matters) != 2 || report.Matters[0].MatterNumber != "MAT-20260614-AAAA1111" {
		t.Fatalf("Matters = %+v, want compact matter summaries", report.Matters)
	}
}

func TestBuildObligationReportJSONRollupsAndDueCounts(t *testing.T) {
	ownerID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	contractID := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	matterID := uuid.MustParse("77777777-7777-7777-7777-777777777777")
	generatedAt := time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC)
	completedAt := generatedAt.AddDate(0, 0, -1)
	dueAfter := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	dueBefore := time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)
	status := model.ObligationStatusOpen
	obligationType := model.ObligationTypeReporting
	priority := model.LegalPriorityHigh

	report := buildObligationReport([]model.Obligation{
		{
			ID:          uuid.MustParse("88888888-8888-8888-8888-888888888888"),
			Title:       "Past due report",
			Type:        model.ObligationTypeReporting,
			Status:      model.ObligationStatusOpen,
			Priority:    model.LegalPriorityHigh,
			OwnerUserID: ownerID,
			OwnerName:   "Contract Owner",
			ContractID:  &contractID,
			DueDate:     generatedAt.AddDate(0, 0, -1),
			CreatedAt:   generatedAt.AddDate(0, 0, -20),
		},
		{
			ID:          uuid.MustParse("99999999-9999-9999-9999-999999999999"),
			Title:       "Upcoming renewal",
			Type:        model.ObligationTypeRenewal,
			Status:      model.ObligationStatusInProgress,
			Priority:    model.LegalPriorityMedium,
			OwnerUserID: ownerID,
			OwnerName:   "Contract Owner",
			MatterID:    &matterID,
			DueDate:     generatedAt.AddDate(0, 0, 7),
			CreatedAt:   generatedAt.AddDate(0, 0, -10),
		},
		{
			ID:          uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
			Title:       "Completed filing",
			Type:        model.ObligationTypeCompliance,
			Status:      model.ObligationStatusCompleted,
			Priority:    model.LegalPriorityLow,
			OwnerUserID: ownerID,
			OwnerName:   "Contract Owner",
			DueDate:     generatedAt.AddDate(0, 0, -3),
			CompletedAt: &completedAt,
			CreatedAt:   generatedAt.AddDate(0, 0, -30),
		},
		{
			ID:          uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
			Title:       "Waived filing",
			Type:        model.ObligationTypeCompliance,
			Status:      model.ObligationStatusWaived,
			Priority:    model.LegalPriorityLow,
			OwnerUserID: ownerID,
			OwnerName:   "Contract Owner",
			DueDate:     generatedAt.AddDate(0, 0, -2),
			CreatedAt:   generatedAt.AddDate(0, 0, -30),
		},
	}, 4, model.ObligationListFilters{
		Search:      "report",
		Status:      &status,
		Type:        &obligationType,
		Priority:    &priority,
		OwnerUserID: &ownerID,
		ContractID:  &contractID,
		MatterID:    &matterID,
		DueAfter:    &dueAfter,
		DueBefore:   &dueBefore,
		Overdue:     true,
		Tag:         "renewal",
	}, generatedAt)

	if report.Overdue != 1 || report.DueSoon != 1 || report.Completed != 1 {
		t.Fatalf("due counts overdue=%d dueSoon=%d completed=%d, want 1/1/1", report.Overdue, report.DueSoon, report.Completed)
	}
	if report.ByStatus["open"] != 1 || report.ByStatus["in_progress"] != 1 || report.ByStatus["completed"] != 1 || report.ByStatus["waived"] != 1 {
		t.Fatalf("ByStatus = %+v, want all status counts", report.ByStatus)
	}
	if report.ByType["reporting"] != 1 || report.ByType["renewal"] != 1 || report.ByType["compliance"] != 2 {
		t.Fatalf("ByType = %+v, want reporting/renewal/compliance counts", report.ByType)
	}
	if report.ByPriority["high"] != 1 || report.ByPriority["medium"] != 1 || report.ByPriority["low"] != 2 {
		t.Fatalf("ByPriority = %+v, want high/medium/low counts", report.ByPriority)
	}
	for key, want := range map[string]string{
		"search":        "report",
		"status":        "open",
		"type":          "reporting",
		"priority":      "high",
		"owner_user_id": ownerID.String(),
		"contract_id":   contractID.String(),
		"matter_id":     matterID.String(),
		"due_after":     "2026-06-01",
		"due_before":    "2026-07-31",
		"overdue":       "true",
		"tag":           "renewal",
	} {
		if report.Filters[key] != want {
			t.Fatalf("Filters[%s] = %q, want %q in %+v", key, report.Filters[key], want, report.Filters)
		}
	}
	if report.Obligations[0].DaysUntilDue != -1 || report.Obligations[1].DaysUntilDue != 7 {
		t.Fatalf("DaysUntilDue = %d/%d, want -1/7", report.Obligations[0].DaysUntilDue, report.Obligations[1].DaysUntilDue)
	}
}
