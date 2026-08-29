package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestMatterConflictCheckResult_DetectsMatterAndContractConflicts(t *testing.T) {
	matterID := uuid.New()
	contractID := uuid.New()
	checkedAt := time.Date(2026, 6, 14, 12, 0, 0, 0, time.UTC)

	result := buildMatterConflictCheckResult(dto.MatterConflictCheckRequest{
		Title:        "Project Falcon Employment Dispute",
		Counterparty: "Acme KSA LLC",
	}, []model.Matter{
		{
			ID:          matterID,
			Title:       "Project Falcon Employment Dispute",
			Description: "Employee exit dispute involving Acme KSA LLC.",
			Metadata:    map[string]any{"counterparty": "Acme KSA LLC"},
		},
	}, []model.Contract{
		{
			ID:          contractID,
			Title:       "Acme Master Services Agreement",
			Description: "Managed service scope for Acme KSA LLC.",
			PartyAName:  "Clario Holdings Limited",
			PartyBName:  "Acme KSA LLC",
		},
	}, checkedAt)

	if !result.CheckedAt.Equal(checkedAt) {
		t.Fatalf("checked_at = %s, want %s", result.CheckedAt, checkedAt)
	}
	if len(result.Conflicts) != 2 {
		t.Fatalf("conflicts = %d, want 2: %+v", len(result.Conflicts), result.Conflicts)
	}
	var sawMatter, sawContract bool
	for _, conflict := range result.Conflicts {
		if conflict.MatterID != nil && *conflict.MatterID == matterID {
			sawMatter = true
		}
		if conflict.ContractID != nil && *conflict.ContractID == contractID {
			sawContract = true
		}
	}
	if !sawMatter || !sawContract {
		t.Fatalf("missing expected conflicts matter=%v contract=%v in %+v", sawMatter, sawContract, result.Conflicts)
	}
	if len(result.Warnings) != 0 {
		t.Fatalf("warnings = %+v, want none", result.Warnings)
	}
}

func TestMatterConflictCheckResult_ReturnsNoMatchesForDistinctContext(t *testing.T) {
	result := buildMatterConflictCheckResult(dto.MatterConflictCheckRequest{
		Title:           "New Retail Lease Advice",
		Counterparty:    "Northstar Properties",
		ContractContext: "Lease review for a Jeddah showroom premises.",
	}, []model.Matter{
		{
			ID:          uuid.New(),
			Title:       "Cloud Procurement Review",
			Description: "Procurement terms for a cloud vendor.",
			Metadata:    map[string]any{"counterparty": "Nimbus Cloud"},
		},
	}, []model.Contract{
		{
			ID:          uuid.New(),
			Title:       "Marketing Agency SOW",
			Description: "Campaign support and social media deliverables.",
			PartyAName:  "Clario Holdings Limited",
			PartyBName:  "Bluewave Agency",
		},
	}, time.Now())

	if len(result.Conflicts) != 0 {
		t.Fatalf("conflicts = %+v, want none", result.Conflicts)
	}
	if len(result.Warnings) != 0 {
		t.Fatalf("warnings = %+v, want none", result.Warnings)
	}
}

func TestMatterConflictCheckResult_DetectsContextWarnings(t *testing.T) {
	contractID := uuid.New()
	result := buildMatterConflictCheckResult(dto.MatterConflictCheckRequest{
		Title:           "Supply Escalation",
		ContractContext: "Distribution exclusivity termination payment milestone issue",
	}, nil, []model.Contract{
		{
			ID:           contractID,
			Title:        "Regional Distribution Framework",
			Description:  "Exclusivity and milestone payment obligations.",
			PartyAName:   "Clario Holdings Limited",
			PartyBName:   "Delta Supply",
			DocumentText: "Termination notice affects milestone payment schedule and exclusivity.",
		},
	}, time.Now())

	if len(result.Conflicts) != 0 {
		t.Fatalf("conflicts = %+v, want none", result.Conflicts)
	}
	if len(result.Warnings) != 1 {
		t.Fatalf("warnings = %d, want 1: %+v", len(result.Warnings), result.Warnings)
	}
	if result.Warnings[0].ContractID == nil || *result.Warnings[0].ContractID != contractID {
		t.Fatalf("warning contract_id = %+v, want %s", result.Warnings[0].ContractID, contractID)
	}
}
