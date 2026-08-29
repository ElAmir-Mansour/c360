package handler

import (
	"testing"

	"github.com/clario360/platform/internal/lex/model"
)

func TestCanViewLateJustificationIsExact(t *testing.T) {
	manager := "legal-contracts-manager"
	tests := []struct {
		name  string
		roles []string
		want  bool
	}{
		{"director", []string{"legal-director"}, true},
		{"matching manager normalized", []string{"LEGAL_CONTRACTS_MANAGER"}, true},
		{"different manager", []string{"legal-cases-manager"}, false},
		{"admin", []string{"admin"}, false},
		{"auditor", []string{"legal-auditor"}, false},
		{"submitter", []string{"legal-contracts-associate"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canViewLateJustification(tt.roles, &manager); got != tt.want {
				t.Fatalf("canView = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestRedactConsultationLateJustification(t *testing.T) {
	manager := "legal-contracts-manager"
	text := "Counterparty feedback arrived after the deadline."
	item := model.Consultation{
		LateJustification:            &text,
		LateJustificationManagerRole: &manager,
	}
	redactConsultationLateJustification(&item, []string{"legal-auditor"})
	if item.LateJustification != nil || item.LateJustificationManagerRole != nil {
		t.Fatal("unauthorized response retained private late-justification data")
	}

	item.LateJustification = &text
	item.LateJustificationManagerRole = &manager
	redactConsultationLateJustification(&item, []string{"legal-contracts-manager"})
	if item.LateJustification == nil || *item.LateJustification != text {
		t.Fatal("matching manager did not receive the justification")
	}
	if item.LateJustificationManagerRole != nil {
		t.Fatal("internal audience role must not be serialized")
	}
}

func TestRedactLegalCaseLateJustification(t *testing.T) {
	manager := "legal-cases-manager"
	justification := "The court delayed the final filing beyond the SLA."
	item := model.LegalCase{
		LateJustification:            &justification,
		LateJustificationManagerRole: &manager,
	}

	redactLegalCaseLateJustification(&item, []string{"legal-contracts-manager"})
	if item.LateJustification != nil || item.LateJustificationManagerRole != nil {
		t.Fatal("unrelated manager retained private case justification data")
	}

	item.LateJustification = &justification
	item.LateJustificationManagerRole = &manager
	redactLegalCaseLateJustification(&item, []string{"legal-director"})
	if item.LateJustification == nil || *item.LateJustification != justification {
		t.Fatal("legal director did not receive the case justification")
	}
	if item.LateJustificationManagerRole != nil {
		t.Fatal("internal case audience role must not be serialized")
	}
}

func TestRedactInvestigationLateJustification(t *testing.T) {
	manager := "legal-cases-manager"
	justification := "Evidence collection depended on an external authority."
	item := model.LegalInvestigation{
		LateJustification:            &justification,
		LateJustificationManagerRole: &manager,
	}

	redactInvestigationLateJustification(&item, []string{"admin"})
	if item.LateJustification != nil || item.LateJustificationManagerRole != nil {
		t.Fatal("administrator retained private investigation justification data")
	}

	item.LateJustification = &justification
	item.LateJustificationManagerRole = &manager
	redactInvestigationLateJustification(&item, []string{"legal-cases-manager"})
	if item.LateJustification == nil || *item.LateJustification != justification {
		t.Fatal("matching cases manager did not receive the investigation justification")
	}
	if item.LateJustificationManagerRole != nil {
		t.Fatal("internal investigation audience role must not be serialized")
	}
}
