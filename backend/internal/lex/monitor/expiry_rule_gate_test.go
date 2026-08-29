package monitor

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

func testExpiryWarningRule(enabled bool, severity model.ComplianceSeverity) *model.ComplianceRule {
	return &model.ComplianceRule{
		ID:       uuid.New(),
		TenantID: uuid.New(),
		Name:     "Expiry warning",
		RuleType: model.ComplianceRuleExpiryWarning,
		Severity: severity,
		Enabled:  enabled,
	}
}

func TestApplyExpiryWarningRule(t *testing.T) {
	contractID := uuid.New()

	newAlert := func() *model.ComplianceAlert {
		return &model.ComplianceAlert{
			ID:         uuid.New(),
			TenantID:   uuid.New(),
			ContractID: &contractID,
			Severity:   model.ComplianceSeverityCritical, // ladder value
			Status:     model.ComplianceAlertOpen,
		}
	}

	t.Run("no rule keeps ladder severity and no rule id", func(t *testing.T) {
		alert := newAlert()
		if !applyExpiryWarningRule(alert, nil) {
			t.Fatal("alert must be created when the tenant has no expiry_warning rule")
		}
		if alert.Severity != model.ComplianceSeverityCritical {
			t.Fatalf("severity = %q, want ladder value critical", alert.Severity)
		}
		if alert.RuleID != nil {
			t.Fatalf("rule id = %v, want nil", alert.RuleID)
		}
	})

	t.Run("disabled rule suppresses the alert", func(t *testing.T) {
		alert := newAlert()
		rule := testExpiryWarningRule(false, model.ComplianceSeverityHigh)
		if applyExpiryWarningRule(alert, rule) {
			t.Fatal("alert must be suppressed when the expiry_warning rule is disabled")
		}
	})

	t.Run("enabled rule overrides severity and stamps rule id", func(t *testing.T) {
		alert := newAlert()
		rule := testExpiryWarningRule(true, model.ComplianceSeverityHigh)
		if !applyExpiryWarningRule(alert, rule) {
			t.Fatal("alert must be created when the expiry_warning rule is enabled")
		}
		if alert.Severity != model.ComplianceSeverityHigh {
			t.Fatalf("severity = %q, want rule severity high", alert.Severity)
		}
		if alert.RuleID == nil || *alert.RuleID != rule.ID {
			t.Fatalf("rule id = %v, want %s", alert.RuleID, rule.ID)
		}
	})
}

func TestPickExpiryWarningRule(t *testing.T) {
	enabled := *testExpiryWarningRule(true, model.ComplianceSeverityHigh)
	disabled := *testExpiryWarningRule(false, model.ComplianceSeverityMedium)
	other := model.ComplianceRule{ID: uuid.New(), RuleType: model.ComplianceRuleMissingClause, Enabled: true}

	t.Run("prefers enabled rule over disabled", func(t *testing.T) {
		got := pickExpiryWarningRule([]model.ComplianceRule{disabled, enabled})
		if got == nil || got.ID != enabled.ID {
			t.Fatalf("picked %+v, want the enabled rule %s", got, enabled.ID)
		}
	})

	t.Run("returns disabled rule when no enabled one exists", func(t *testing.T) {
		got := pickExpiryWarningRule([]model.ComplianceRule{other, disabled})
		if got == nil || got.ID != disabled.ID {
			t.Fatalf("picked %+v, want the disabled rule %s", got, disabled.ID)
		}
	})

	t.Run("ignores other rule types", func(t *testing.T) {
		if got := pickExpiryWarningRule([]model.ComplianceRule{other}); got != nil {
			t.Fatalf("picked %+v, want nil", got)
		}
	})

	t.Run("nil when tenant has no rules", func(t *testing.T) {
		if got := pickExpiryWarningRule(nil); got != nil {
			t.Fatalf("picked %+v, want nil", got)
		}
	})
}

func TestExpiryRuleCache(t *testing.T) {
	t.Run("nil cache behaves as no rule", func(t *testing.T) {
		var cache *expiryRuleCache
		cache.reset() // must not panic
		if got := cache.get(context.Background(), uuid.New()); got != nil {
			t.Fatalf("nil cache returned %+v, want nil", got)
		}
	})

	t.Run("memoizes one lookup per tenant until reset", func(t *testing.T) {
		tenantA, tenantB := uuid.New(), uuid.New()
		rule := testExpiryWarningRule(true, model.ComplianceSeverityHigh)
		calls := map[uuid.UUID]int{}
		cache := newExpiryRuleCache(func(_ context.Context, tenantID uuid.UUID) (*model.ComplianceRule, error) {
			calls[tenantID]++
			if tenantID == tenantA {
				return rule, nil
			}
			return nil, nil
		}, zerolog.Nop())

		for i := 0; i < 3; i++ {
			if got := cache.get(context.Background(), tenantA); got != rule {
				t.Fatalf("tenant A rule = %+v, want %+v", got, rule)
			}
			if got := cache.get(context.Background(), tenantB); got != nil {
				t.Fatalf("tenant B rule = %+v, want nil (no rule)", got)
			}
		}
		if calls[tenantA] != 1 || calls[tenantB] != 1 {
			t.Fatalf("lookup calls = %v, want exactly 1 per tenant", calls)
		}

		// A reset (new run) must re-read the rule so toggles take effect.
		cache.reset()
		cache.get(context.Background(), tenantA)
		if calls[tenantA] != 2 {
			t.Fatalf("lookup calls after reset = %d, want 2", calls[tenantA])
		}
	})

	t.Run("lookup error fails open as no rule", func(t *testing.T) {
		calls := 0
		cache := newExpiryRuleCache(func(context.Context, uuid.UUID) (*model.ComplianceRule, error) {
			calls++
			return nil, errors.New("rules table unavailable")
		}, zerolog.Nop())

		tenant := uuid.New()
		if got := cache.get(context.Background(), tenant); got != nil {
			t.Fatalf("rule on lookup error = %+v, want nil (fail open)", got)
		}
		// The failure result is cached for the run: no per-contract retries.
		cache.get(context.Background(), tenant)
		if calls != 1 {
			t.Fatalf("lookup calls = %d, want 1 (error cached for the run)", calls)
		}
	})
}
