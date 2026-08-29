package handler

import (
	"strings"

	"github.com/clario360/platform/internal/lex/model"
)

func normalizeLateJustificationRole(role string) string {
	return strings.ReplaceAll(strings.ToLower(strings.TrimSpace(role)), "_", "-")
}

func canViewLateJustification(roles []string, managerRole *string) bool {
	wanted := ""
	if managerRole != nil {
		wanted = normalizeLateJustificationRole(*managerRole)
	}
	for _, role := range roles {
		normalized := normalizeLateJustificationRole(role)
		if normalized == "legal-director" || (wanted != "" && normalized == wanted) {
			return true
		}
	}
	return false
}

func redactDeliveryLateJustification(item *model.DeliveryConfirmation, roles []string) {
	if item == nil {
		return
	}
	allowed := canViewLateJustification(roles, item.LateJustificationManagerRole)
	item.LateJustificationManagerRole = nil
	if allowed {
		return
	}
	item.LateJustification = nil
	item.LateJustificationSubmittedBy = nil
	item.LateJustificationSubmittedAt = nil
}

func redactConsultationLateJustification(item *model.Consultation, roles []string) {
	if item == nil {
		return
	}
	allowed := canViewLateJustification(roles, item.LateJustificationManagerRole)
	item.LateJustificationManagerRole = nil
	if allowed {
		return
	}
	item.LateJustification = nil
	item.LateJustificationSubmittedBy = nil
	item.LateJustificationSubmittedAt = nil
}

func redactLegalCaseLateJustification(item *model.LegalCase, roles []string) {
	if item == nil {
		return
	}
	allowed := canViewLateJustification(roles, item.LateJustificationManagerRole)
	item.LateJustificationManagerRole = nil
	if allowed {
		return
	}
	item.LateJustification = nil
	item.LateJustificationSubmittedBy = nil
	item.LateJustificationSubmittedAt = nil
}

func redactInvestigationLateJustification(item *model.LegalInvestigation, roles []string) {
	if item == nil {
		return
	}
	allowed := canViewLateJustification(roles, item.LateJustificationManagerRole)
	item.LateJustificationManagerRole = nil
	if allowed {
		return
	}
	item.LateJustification = nil
	item.LateJustificationSubmittedBy = nil
	item.LateJustificationSubmittedAt = nil
}
