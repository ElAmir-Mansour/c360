package service

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/model"
)

// eligibilityInput is the resolved requester context an eligibility evaluation
// runs against (CAP-008). It is deliberately a plain value with no DB access so
// the predicates below are pure and unit-testable; the calling service resolves
// the org-registry facts (department, role keys, beneficiary code) up front.
type eligibilityInput struct {
	RequesterUserID uuid.UUID
	// Department is the requester's department code/name (case-insensitive match).
	Department string
	// RoleKeys are the org-registry role keys the requester holds (e.g.
	// department_manager) used by the `role` and `doa_matrix` predicates.
	RoleKeys map[string]struct{}
	// BeneficiaryCode is the org entity code the request is being raised for.
	BeneficiaryCode string
}

// evaluateEligibility applies a service's CAP-008 eligibility rules to a
// requester. The rule set is ANY-of: the requester is eligible if at least one
// rule matches. A service with NO rules is open (everyone eligible). The
// returned decision lists the matched rule on success, or the per-rule denial
// reasons on failure.
//
// This is a pure predicate: no DB, no clock, no side effects.
func evaluateEligibility(service *model.ServiceCatalogEntry, rules []model.ServiceEligibilityRule, input eligibilityInput) model.EligibilityDecision {
	decision := model.EligibilityDecision{
		ServiceID:   service.ID,
		ServiceCode: service.Code,
	}

	// No rules => open service: anyone may request.
	if len(rules) == 0 {
		decision.Eligible = true
		decision.MatchedRule = string(model.EligibilityRuleAll)
		return decision
	}

	reasons := make([]string, 0, len(rules))
	for _, rule := range rules {
		if ruleMatches(rule, input) {
			decision.Eligible = true
			decision.MatchedRule = string(rule.RuleType)
			decision.Reasons = nil
			return decision
		}
		reasons = append(reasons, eligibilityDenyReason(rule))
	}
	decision.Eligible = false
	decision.Reasons = uniqueStrings(reasons)
	return decision
}

func resolveEligibilityInput(ctx context.Context, tenantID uuid.UUID, orgs *OrgEntityService, requesterUserID uuid.UUID, department, beneficiaryCode *string, beneficiaryEntityID *uuid.UUID, rules []model.ServiceEligibilityRule) (eligibilityInput, error) {
	input := eligibilityInput{
		RequesterUserID: requesterUserID,
		RoleKeys:        map[string]struct{}{},
	}
	if department != nil {
		input.Department = strings.TrimSpace(*department)
	}
	if beneficiaryCode != nil {
		input.BeneficiaryCode = strings.ToUpper(strings.TrimSpace(*beneficiaryCode))
	}
	if orgs == nil {
		return input, nil
	}

	var entity *model.OrgEntity
	var err error
	switch {
	case beneficiaryEntityID != nil && *beneficiaryEntityID != uuid.Nil:
		entity, err = orgs.Get(ctx, tenantID, *beneficiaryEntityID)
	case input.BeneficiaryCode != "":
		entity, err = orgs.GetByCode(ctx, tenantID, input.BeneficiaryCode)
	}
	if err != nil {
		if isEligibilityOrgNotFound(err) {
			return input, nil
		}
		return input, err
	}
	if entity == nil {
		return input, nil
	}

	input.BeneficiaryCode = entity.Code
	if input.Department == "" {
		input.Department = entity.Code
	}
	for _, role := range entity.Roles {
		if role.UserID == requesterUserID {
			addEligibilityRoleKey(input.RoleKeys, role.RoleKey)
		}
	}

	roleKeys := eligibilityRoleKeys(rules)
	if len(roleKeys) == 0 {
		return input, nil
	}
	resolution, err := orgs.ResolveAddressableRoleRecipients(ctx, tenantID, entity.ID, roleKeys)
	if err != nil {
		return input, err
	}
	for _, recipient := range resolution.Recipients {
		if recipient.UserID == requesterUserID {
			addEligibilityRoleKey(input.RoleKeys, recipient.RoleKey)
		}
	}
	return input, nil
}

// ruleMatches reports whether a single CAP-008 predicate is satisfied by the
// requester context.
func ruleMatches(rule model.ServiceEligibilityRule, input eligibilityInput) bool {
	switch rule.RuleType {
	case model.EligibilityRuleAll:
		return true
	case model.EligibilityRuleDepartment:
		return strings.EqualFold(strings.TrimSpace(rule.Value), strings.TrimSpace(input.Department)) ||
			strings.EqualFold(strings.TrimSpace(rule.Value), strings.TrimSpace(input.BeneficiaryCode))
	case model.EligibilityRuleRole:
		_, ok := input.RoleKeys[strings.ToLower(strings.TrimSpace(rule.Value))]
		return ok
	case model.EligibilityRuleDoAMatrix:
		// The DoA-matrix predicate is satisfied when the requester carries a
		// delegation-bearing org role (section_supervisor / department_manager /
		// shared_services_manager / legal_director / general_counsel). The rule's
		// value, when present, narrows to a specific required role key.
		required := strings.ToLower(strings.TrimSpace(rule.Value))
		if required != "" {
			_, ok := input.RoleKeys[required]
			return ok
		}
		for _, key := range doaAuthorityRoleKeys {
			if _, ok := input.RoleKeys[key]; ok {
				return true
			}
		}
		return false
	default:
		return false
	}
}

// doaAuthorityRoleKeys is the set of org role keys that confer delegation
// authority under the default DoA-matrix predicate.
var doaAuthorityRoleKeys = []string{
	string(model.OrgRoleSectionSupervisor),
	string(model.OrgRoleDepartmentManager),
	string(model.OrgRoleSharedServicesManager),
	string(model.OrgRoleLegalDirector),
	string(model.OrgRoleGeneralCounsel),
}

func eligibilityDenyReason(rule model.ServiceEligibilityRule) string {
	switch rule.RuleType {
	case model.EligibilityRuleDepartment:
		return "requester_department_not_in:" + rule.Value
	case model.EligibilityRuleRole:
		return "requester_missing_role:" + rule.Value
	case model.EligibilityRuleDoAMatrix:
		if strings.TrimSpace(rule.Value) != "" {
			return "requester_missing_doa_role:" + rule.Value
		}
		return "requester_lacks_doa_authority"
	default:
		return "rule_not_satisfied:" + string(rule.RuleType)
	}
}

func eligibilityRoleKeys(rules []model.ServiceEligibilityRule) []model.OrgRoleKey {
	out := make([]model.OrgRoleKey, 0, len(rules))
	seen := map[model.OrgRoleKey]struct{}{}
	add := func(key model.OrgRoleKey) {
		key = model.OrgRoleKey(strings.ToLower(strings.TrimSpace(string(key))))
		if key == "" {
			return
		}
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	for _, rule := range rules {
		switch rule.RuleType {
		case model.EligibilityRuleRole:
			add(model.OrgRoleKey(rule.Value))
		case model.EligibilityRuleDoAMatrix:
			if strings.TrimSpace(rule.Value) != "" {
				add(model.OrgRoleKey(rule.Value))
				continue
			}
			for _, key := range doaAuthorityRoleKeys {
				add(model.OrgRoleKey(key))
			}
		}
	}
	return out
}

func addEligibilityRoleKey(roleKeys map[string]struct{}, roleKey model.OrgRoleKey) {
	key := strings.ToLower(strings.TrimSpace(string(roleKey)))
	if key != "" {
		roleKeys[key] = struct{}{}
	}
}

func isEligibilityOrgNotFound(err error) bool {
	return err == pgx.ErrNoRows || errors.Is(err, apperrors.ErrNotFound)
}
