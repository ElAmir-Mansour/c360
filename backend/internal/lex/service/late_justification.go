package service

import (
	"strings"
	"time"

	"github.com/clario360/platform/internal/lex/model"
)

const (
	legalDirectorRole              = "legal-director"
	legalContractsManagerRole      = "legal-contracts-manager"
	legalCasesManagerRole          = "legal-cases-manager"
	legalSharedServicesManagerRole = "legal-shared-services-manager"
	legalDepartmentManagerRole     = "legal-dept-manager"
)

// validateLateJustification uses the materialised deadline, not the eventually
// consistent breached flag, so completing one millisecond after SLA cannot race
// the monitor. On-time submissions discard an unsolicited explanation.
func validateLateJustification(deadline *time.Time, now time.Time, raw *string) (*string, error) {
	if deadline == nil || !now.After(deadline.UTC()) {
		return nil, nil
	}
	value := ""
	if raw != nil {
		value = strings.TrimSpace(*raw)
	}
	if value == "" {
		return nil, validationError("late justification is required because the record ended after its SLA deadline", map[string]string{
			"late_justification": "required",
		})
	}
	return &value, nil
}

// lateJustificationManagerRole records one precise visibility audience beside
// the explanation. It is intentionally conservative: unknown/general services
// route to the Shared Services manager rather than every legal manager.
func lateJustificationManagerRole(subjectType, serviceCode string) string {
	subject := strings.ToLower(strings.TrimSpace(subjectType))
	service := strings.ToLower(strings.TrimSpace(serviceCode))
	value := strings.TrimSpace(subject + " " + service)
	switch {
	case strings.Contains(value, "contract"), strings.Contains(value, "consultation"), strings.Contains(value, "legal_opinion"), strings.Contains(value, "playbook"), strings.Contains(value, "clause"):
		return legalContractsManagerRole
	case strings.Contains(value, "case"), strings.Contains(value, "litigation"), strings.Contains(value, "investigation"), strings.Contains(value, "settlement"),
		strings.Contains(value, strings.ToLower(model.ServiceCodeEnforcementRequest)), strings.Contains(value, strings.ToLower(model.ServiceCodeViolationStudy)), strings.Contains(value, strings.ToLower(model.ServiceCodeFieldInspection)):
		return legalCasesManagerRole
	case (subject == "legal_request" && service == ""), strings.Contains(subject, "legal_request_approval"), strings.Contains(subject, "requester_approval"):
		return legalDepartmentManagerRole
	default:
		return legalSharedServicesManagerRole
	}
}
