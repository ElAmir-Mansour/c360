package service

import (
	"testing"
	"time"

	"github.com/clario360/platform/internal/lex/model"
)

func TestValidateCaseFinancials(t *testing.T) {
	amount := 1_250_000.0
	fees := 3_500.0
	currency := "SAR"
	if err := validateCaseFinancials(&amount, &fees, nil, &currency); err != nil {
		t.Fatalf("valid financials rejected: %v", err)
	}
	negative := -1.0
	if err := validateCaseFinancials(&negative, nil, nil, &currency); err == nil {
		t.Fatal("negative claim amount accepted")
	}
	badCurrency := "SA"
	if err := validateCaseFinancials(&amount, nil, nil, &badCurrency); err == nil {
		t.Fatal("invalid currency accepted")
	}
}

func TestValidateCaseMilestone(t *testing.T) {
	date := time.Date(2026, 8, 10, 9, 0, 0, 0, time.UTC)
	if err := validateCaseMilestone(
		"Submit brief",
		model.CaseMilestoneTypeSubmission,
		model.CaseMilestoneStatusPlanned,
		date,
		nil,
	); err != nil {
		t.Fatalf("valid milestone rejected: %v", err)
	}
	if err := validateCaseMilestone(
		"",
		model.CaseMilestoneType("unknown"),
		model.CaseMilestoneStatus("unknown"),
		time.Time{},
		nil,
	); err == nil {
		t.Fatal("invalid milestone accepted")
	}
	if err := validateCaseMilestone(
		"Decision received",
		model.CaseMilestoneTypeDecision,
		model.CaseMilestoneStatusCompleted,
		date,
		nil,
	); err == nil {
		t.Fatal("completed milestone without completed_at accepted")
	}
}
