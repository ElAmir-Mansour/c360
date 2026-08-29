package dto

import (
	"strings"

	"github.com/clario360/platform/internal/lex/model"
)

type CreateComplianceRuleRequest struct {
	Name          string                   `json:"name"`
	Description   string                   `json:"description"`
	RuleType      model.ComplianceRuleType `json:"rule_type"`
	Severity      model.ComplianceSeverity `json:"severity"`
	Config        map[string]any           `json:"config"`
	ContractTypes []string                 `json:"contract_types"`
	Enabled       bool                     `json:"enabled"`
}

type UpdateComplianceRuleRequest struct {
	Name          *string                   `json:"name,omitempty"`
	Description   *string                   `json:"description,omitempty"`
	RuleType      *model.ComplianceRuleType `json:"rule_type,omitempty"`
	Severity      *model.ComplianceSeverity `json:"severity,omitempty"`
	Config        map[string]any            `json:"config,omitempty"`
	ContractTypes []string                  `json:"contract_types,omitempty"`
	Enabled       *bool                     `json:"enabled,omitempty"`
}

type RunComplianceRequest struct {
	ContractIDs []string `json:"contract_ids,omitempty"`
}

type UpdateAlertStatusRequest struct {
	Status          model.ComplianceAlertStatus `json:"status"`
	ResolutionNotes string                      `json:"resolution_notes"`
}

func (r *CreateComplianceRuleRequest) Normalize() {
	r.Name = strings.TrimSpace(r.Name)
	r.Description = strings.TrimSpace(r.Description)
	if r.Config == nil {
		r.Config = map[string]any{}
	}
	r.ContractTypes = normalizeStringList(r.ContractTypes)
}

func normalizeStringList(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func (r *UpdateAlertStatusRequest) Normalize() {
	r.ResolutionNotes = strings.TrimSpace(r.ResolutionNotes)
}
