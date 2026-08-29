package dto

import (
	"testing"

	"github.com/clario360/platform/internal/lex/model"
)

func TestServiceCatalogDTONormalizeRolePredicatesAndWebhookTimestamp(t *testing.T) {
	create := CreateServiceCatalogRequest{
		Code:        " contract_review ",
		RequestType: " contract_review ",
		Channel:     model.ServiceChannelBoth,
		IntakeEmail: stringPtr(" Legal@Example.COM "),
		EligibilityRules: []ServiceEligibilityRuleRequest{
			{RuleType: model.EligibilityRuleRole, Value: " Legal_Director "},
			{RuleType: model.EligibilityRuleDepartment, Value: " Finance "},
		},
	}
	create.Normalize()
	if create.Code != model.ServiceCodeContractReview {
		t.Fatalf("code = %q, want %q", create.Code, model.ServiceCodeContractReview)
	}
	if create.IntakeEmail == nil || *create.IntakeEmail != "legal@example.com" {
		t.Fatalf("intake email = %v, want lowercase trimmed", create.IntakeEmail)
	}
	if create.EligibilityRules[0].Value != "legal_director" {
		t.Fatalf("role value = %q, want lower-case org role key", create.EligibilityRules[0].Value)
	}
	if create.EligibilityRules[1].Value != "Finance" {
		t.Fatalf("department value = %q, want case preserved", create.EligibilityRules[1].Value)
	}

	webhook := IntakeEmailWebhookRequest{
		MessageID:        " <msg-1> ",
		From:             " Sender@Example.COM ",
		To:               " Legal@Example.COM ",
		Subject:          " Contract review ",
		WebhookTimestamp: " 2026-06-24T12:00:00Z ",
	}
	webhook.Normalize()
	if webhook.From != "sender@example.com" || webhook.To != "legal@example.com" || webhook.WebhookTimestamp != "2026-06-24T12:00:00Z" {
		t.Fatalf("webhook normalized = %+v, want trimmed/lowercase addressing and timestamp", webhook)
	}
}

func stringPtr(value string) *string {
	return &value
}
