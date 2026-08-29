package monitor

import (
	"context"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// The expiry monitor and renewal reminder mint compliance alerts outside the
// rule engine, but the compliance surface promises that disabled rules are
// skipped. This gate makes both monitors honor the tenant's expiry_warning
// rule (there is no dedicated renewal rule type in the model, so renewal
// reminders are governed by the same rule):
//   - rule exists and is disabled  -> the compliance alert is suppressed
//     (contract.expiring events / notification markers still fire as before);
//   - rule exists and is enabled   -> the rule's severity replaces the
//     hardcoded ladder and the rule id is stamped on the alert;
//   - no rule row at all           -> legacy behavior, so tenants without
//     seeded rules keep alerting on the ladder severities.

// expiryRuleCache memoizes the per-tenant expiry_warning rule for the duration
// of one monitor run, so a tenant with many due contracts costs one query. A
// nil cache (tests building monitors via struct literal) behaves as "no rule".
type expiryRuleCache struct {
	lookup func(context.Context, uuid.UUID) (*model.ComplianceRule, error)
	logger zerolog.Logger
	rules  map[uuid.UUID]*model.ComplianceRule
}

func newExpiryRuleCache(lookup func(context.Context, uuid.UUID) (*model.ComplianceRule, error), logger zerolog.Logger) *expiryRuleCache {
	return &expiryRuleCache{lookup: lookup, logger: logger}
}

// reset drops the memoized rules so the next run observes rule toggles made
// between iterations. Call it at the top of each RunOnce.
func (c *expiryRuleCache) reset() {
	if c == nil {
		return
	}
	c.rules = nil
}

// get returns the tenant's expiry_warning rule, or nil when the tenant has
// none. Lookup failures fail open (treated as "no rule" for the rest of the
// run) so a transient rules-table error cannot suppress expiry alerting.
func (c *expiryRuleCache) get(ctx context.Context, tenantID uuid.UUID) *model.ComplianceRule {
	if c == nil || c.lookup == nil {
		return nil
	}
	if rule, ok := c.rules[tenantID]; ok {
		return rule
	}
	rule, err := c.lookup(ctx, tenantID)
	if err != nil {
		c.logger.Error().Err(err).Str("tenant_id", tenantID.String()).Msg("lookup expiry_warning compliance rule; falling back to default alerting")
		rule = nil
	}
	if c.rules == nil {
		c.rules = make(map[uuid.UUID]*model.ComplianceRule)
	}
	c.rules[tenantID] = rule
	return rule
}

// expiryWarningRuleLookup is the production per-tenant lookup, backed by the
// compliance repository. A nil repository (or no matching row) yields nil.
func expiryWarningRuleLookup(rules *repository.ComplianceRepository) func(context.Context, uuid.UUID) (*model.ComplianceRule, error) {
	return func(ctx context.Context, tenantID uuid.UUID) (*model.ComplianceRule, error) {
		if rules == nil {
			return nil, nil
		}
		all, err := rules.ListRules(ctx, tenantID)
		if err != nil {
			return nil, err
		}
		return pickExpiryWarningRule(all), nil
	}
}

// pickExpiryWarningRule selects the tenant's governing expiry_warning rule.
// When a tenant has several, an enabled one wins (so alerting stays on with
// that rule's severity); otherwise the first disabled one is returned so the
// gate still suppresses alerts.
func pickExpiryWarningRule(rules []model.ComplianceRule) *model.ComplianceRule {
	var disabled *model.ComplianceRule
	for i := range rules {
		if rules[i].RuleType != model.ComplianceRuleExpiryWarning {
			continue
		}
		if rules[i].Enabled {
			return &rules[i]
		}
		if disabled == nil {
			disabled = &rules[i]
		}
	}
	return disabled
}

// applyExpiryWarningRule applies the three-case gate to a monitor-built alert
// and reports whether the alert should be created. On the enabled path it
// mutates the alert in place: rule severity replaces the ladder severity and
// the rule id is attached so the alert is traceable to its governing rule.
func applyExpiryWarningRule(alert *model.ComplianceAlert, rule *model.ComplianceRule) bool {
	if rule == nil {
		return true
	}
	if !rule.Enabled {
		return false
	}
	alert.Severity = rule.Severity
	ruleID := rule.ID
	alert.RuleID = &ruleID
	return true
}
