package lex

import (
	"reflect"
	"testing"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/model"
)

func TestLegalServiceCatalogSeedMatchesOthaimPRD(t *testing.T) {
	services := legalServiceCatalogSeed()
	if len(services) != 8 {
		t.Fatalf("legalServiceCatalogSeed() returned %d services, want 8", len(services))
	}

	gotCodes := make([]string, 0, len(services))
	for _, service := range services {
		gotCodes = append(gotCodes, service.Code)
		if service.Channel != model.ServiceChannelBoth {
			t.Errorf("%s channel = %s, want both", service.Code, service.Channel)
		}
		if mailbox, _ := service.Metadata["intake_mailbox"].(string); mailbox == "" {
			t.Errorf("%s has no shared intake mailbox", service.Code)
		}
	}
	if !reflect.DeepEqual(gotCodes, model.DefaultLegalServiceCodes) {
		t.Fatalf("catalog codes = %#v, want %#v", gotCodes, model.DefaultLegalServiceCodes)
	}

	byCode := make(map[string][2]bool, len(services))
	for _, service := range services {
		byCode[service.Code] = [2]bool{service.RequesterApprovalReqd, service.ProviderApprovalReqd}
	}
	// {RequesterApprovalReqd, ProviderApprovalReqd}. Ordinary services carry a
	// SINGLE approval gate: consultation/opinion use the requester (business)
	// stage; the five operational services use the provider (Legal Director)
	// stage. The previous requester+provider double-gate on those five was
	// redundant — with no distinct-approver policy the same director cleared both
	// stages (two Approve clicks, zero added segregation). Only LITIGATION keeps
	// two stages, because it is backed by a real 3-role distinct-approver policy
	// (seed_legal_affairs.go) and is genuine four-eyes.
	wantApprovals := map[string][2]bool{
		model.ServiceCodeLegalConsultation:  {true, false},
		model.ServiceCodeContractReview:     {false, true},
		model.ServiceCodeLegalOpinion:       {true, false},
		model.ServiceCodeLitigationSupport:  {true, true},
		model.ServiceCodeEnforcementRequest: {false, true},
		model.ServiceCodeViolationStudy:     {false, true},
		model.ServiceCodeFieldInspection:    {false, true},
		model.ServiceCodePowerOfAttorney:    {false, true},
	}
	if !reflect.DeepEqual(byCode, wantApprovals) {
		t.Fatalf("approval matrix = %#v, want %#v", byCode, wantApprovals)
	}

	wantNames := map[string]string{
		model.ServiceCodeLegalConsultation:  "Legal Consultations",
		model.ServiceCodeContractReview:     "Review of Contracts and Agreements",
		model.ServiceCodeLegalOpinion:       "Providing Preliminary Legal Study",
		model.ServiceCodeLitigationSupport:  "Judicial Case Study",
		model.ServiceCodeEnforcementRequest: "Submission of Execution Request",
		model.ServiceCodeViolationStudy:     "Investigation of Violation or Breach",
		model.ServiceCodeFieldInspection:    "Field Inspection and Incident Documentation",
		model.ServiceCodePowerOfAttorney:    "Issuing Power of Attorney and Delegations",
	}
	for _, service := range services {
		if service.Name.EN != wantNames[service.Code] {
			t.Errorf("%s English name = %q, want %q", service.Code, service.Name.EN, wantNames[service.Code])
		}
	}
}

// TestSeededRequestApprovalTemplateRolesResolve locks the F15 fix: every
// {"type":"role"} approver reference in the seeded request-approval policy
// templates must resolve to a real slug defined in
// auth.LegalAffairsRoleDefs. A prior seed shipped 8 bad slugs (legal-counsel,
// department-head, general-counsel, finance-controller, ...) that matched no
// seeded role, so the instantiated policies were never approvable. This test
// fails fast if any template regresses to a non-existent role slug.
func TestSeededRequestApprovalTemplateRolesResolve(t *testing.T) {
	// Build the set of real, seedable legal-affairs role slugs.
	validSlugs := make(map[string]struct{}, len(auth.LegalAffairsRoleDefs))
	for _, def := range auth.LegalAffairsRoleDefs {
		validSlugs[def.Slug] = struct{}{}
	}
	if len(validSlugs) == 0 {
		t.Fatal("auth.LegalAffairsRoleDefs is empty; cannot validate template role refs")
	}

	templates := seedRequestApprovalPolicyTemplates()
	if len(templates) == 0 {
		t.Fatal("seedRequestApprovalPolicyTemplates returned no templates")
	}

	roleRefCount := 0
	for _, tmpl := range templates {
		approvers, ok := tmpl.Definition["approvers"].([]map[string]any)
		if !ok {
			// Not every template must carry approvers in this shape, but the
			// seeded starters all do; flag a shape drift explicitly.
			t.Errorf("template %q: approvers not []map[string]any (got %T)", tmpl.Name, tmpl.Definition["approvers"])
			continue
		}
		for i, approver := range approvers {
			refType, _ := approver["type"].(string)
			if refType != "role" {
				continue
			}
			ref, _ := approver["ref"].(string)
			if ref == "" {
				t.Errorf("template %q approver[%d]: role reference has empty ref", tmpl.Name, i)
				continue
			}
			roleRefCount++
			if _, found := validSlugs[ref]; !found {
				t.Errorf("template %q approver[%d]: role slug %q not found in auth.LegalAffairsRoleDefs", tmpl.Name, i, ref)
			}
		}
	}

	if roleRefCount == 0 {
		t.Fatal("no {type:\"role\"} references found across seeded templates; test would be vacuous")
	}
}
