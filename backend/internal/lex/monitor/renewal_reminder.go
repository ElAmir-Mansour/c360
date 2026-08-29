package monitor

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	"github.com/clario360/platform/internal/lex/service"
)

type RenewalReminder struct {
	publisher service.Publisher
	topic     string
	interval  time.Duration
	logger    zerolog.Logger
	now       func() time.Time

	// expiryRules gates compliance-alert creation on the tenant's
	// expiry_warning rule — the model has no dedicated renewal rule type, so
	// renewal reminders are governed by the same rule as expiry alerts (see
	// expiry_rule_gate.go). nil (struct-literal tests) behaves as "no rule".
	expiryRules *expiryRuleCache
	// listDueFunc returns the contracts to evaluate for an auto-renewal reminder.
	// In production it is wired to the contract repository's expiry-bucket query;
	// tests inject a deterministic list.
	listDueFunc func(context.Context) ([]model.Contract, error)
	// createAlertFunc performs the dedup-aware alert insert and reports whether a
	// new alert was created (false => an open alert with the same dedup key
	// already existed). In production it runs the insert inside a transaction;
	// tests inject an in-memory dedup store.
	createAlertFunc func(context.Context, *model.ComplianceAlert) (bool, error)
}

func NewRenewalReminder(
	db *pgxpool.Pool,
	contracts *repository.ContractRepository,
	alerts *repository.AlertRepository,
	rules *repository.ComplianceRepository,
	publisher service.Publisher,
	topic string,
	interval time.Duration,
	logger zerolog.Logger,
) *RenewalReminder {
	if interval <= 0 {
		interval = 6 * time.Hour
	}
	componentLogger := logger.With().Str("component", "lex-renewal-reminder").Logger()
	r := &RenewalReminder{
		publisher:   publisher,
		topic:       topic,
		interval:    interval,
		logger:      componentLogger,
		now:         time.Now,
		expiryRules: newExpiryRuleCache(expiryWarningRuleLookup(rules), componentLogger),
	}
	// Wire the production seams: the listing query and the transactional,
	// dedup-aware alert insert. RLS tenant scoping is handled by the alert
	// repository insert exactly as the expiry monitor does.
	r.listDueFunc = func(ctx context.Context) ([]model.Contract, error) {
		return contracts.ListDueForExpiryBucket(ctx, -1, 365)
	}
	r.createAlertFunc = func(ctx context.Context, alert *model.ComplianceAlert) (bool, error) {
		tx, err := db.Begin(ctx)
		if err != nil {
			return false, err
		}
		committed := false
		defer func() {
			if !committed {
				_ = tx.Rollback(ctx)
			}
		}()
		created, err := alerts.CreateOrSkipDedup(ctx, tx, alert)
		if err != nil {
			return false, err
		}
		if err := tx.Commit(ctx); err != nil {
			return false, err
		}
		committed = true
		return created, nil
	}
	return r
}

func (r *RenewalReminder) Run(ctx context.Context) error {
	if err := r.RunOnce(ctx); err != nil && ctx.Err() == nil {
		r.logger.Error().Err(err).Msg("renewal reminder iteration failed")
	}

	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := r.RunOnce(ctx); err != nil && ctx.Err() == nil {
				r.logger.Error().Err(err).Msg("renewal reminder iteration failed")
			}
		}
	}
}

func (r *RenewalReminder) RunOnce(ctx context.Context) error {
	candidates, err := r.listDueFunc(ctx)
	if err != nil {
		return err
	}
	// Re-read each tenant's expiry_warning rule at most once per iteration so
	// rule toggles between runs take effect without a per-contract query.
	r.expiryRules.reset()

	var errs []error
	for _, contract := range candidates {
		if !contract.AutoRenew || contract.Status != model.ContractStatusActive || contract.ExpiryDate == nil {
			continue
		}
		reminderDate := renewalReminderDate(&contract)
		today := normalizeMonitorDate(r.now())
		if reminderDate.After(today.AddDate(0, 0, 7)) {
			continue
		}
		if normalizeMonitorDate(*contract.ExpiryDate).Before(today) {
			continue
		}
		if err := r.createReminder(ctx, &contract, reminderDate); err != nil {
			errs = append(errs, fmt.Errorf("contract %s: %w", contract.ID, err))
		}
	}
	return errors.Join(errs...)
}

func (r *RenewalReminder) createReminder(ctx context.Context, contract *model.Contract, reminderDate time.Time) error {
	alert := buildRenewalAlert(contract, reminderDate, r.now())
	// Gate on the tenant's expiry_warning rule: a disabled rule suppresses the
	// compliance alert entirely; an enabled rule overrides the days-remaining
	// severity ladder and stamps its id on the alert.
	if !applyExpiryWarningRule(alert, r.expiryRules.get(ctx, contract.TenantID)) {
		return nil
	}

	created, err := r.createAlertFunc(ctx, alert)
	if err != nil {
		return err
	}

	if created {
		publishLexEvent(ctx, r.publisher, r.topic, "com.clario360.lex.compliance.alert_created", contract.TenantID, nil, map[string]any{
			"id":          alert.ID,
			"contract_id": alert.ContractID,
			"severity":    alert.Severity,
			"title":       alert.Title,
		}, r.logger)
	}
	return nil
}

// buildRenewalAlert constructs the renewal-decision compliance alert for a
// contract. The dedup key is CONTRACT-scoped (not reminder-date-scoped) so a
// renewal/expiry date that shifts between runs (e.g. a contract amendment) does
// not raise a second open alert for the same contract; once the open alert is
// resolved or dismissed it leaves the partial unique index and a fresh alert may
// be raised again.
func buildRenewalAlert(contract *model.Contract, reminderDate time.Time, now time.Time) *model.ComplianceAlert {
	daysRemaining := daysUntilExpiry(contract.ExpiryDate, now)
	dedupKey := "renewal:" + contract.ID.String()
	return &model.ComplianceAlert{
		ID:          uuid.New(),
		TenantID:    contract.TenantID,
		ContractID:  &contract.ID,
		Title:       fmt.Sprintf("قرار التجديد مطلوب للعقد «%s»", contract.Title),
		Description: fmt.Sprintf("تاريخ مراجعة التجديد التلقائي هو %s للعقد الذي تنتهي مدته في %s.", reminderDate.Format("2006-01-02"), contract.ExpiryDate.UTC().Format("2006-01-02")),
		Severity:    renewalSeverity(daysRemaining),
		Status:      model.ComplianceAlertOpen,
		DedupKey:    &dedupKey,
		Evidence: map[string]any{
			"contract_id":         contract.ID,
			"contract_title":      contract.Title,
			"renewal_date":        reminderDate,
			"expiry_date":         contract.ExpiryDate,
			"days_until_expiry":   daysRemaining,
			"renewal_notice_days": contract.RenewalNoticeDays,
			"auto_renew":          contract.AutoRenew,
			"owner_name":          contract.OwnerName,
			"legal_reviewer_name": contract.LegalReviewerName,
			"department":          contract.Department,
		},
	}
}

func renewalReminderDate(contract *model.Contract) time.Time {
	if contract != nil && contract.RenewalDate != nil {
		return normalizeMonitorDate(*contract.RenewalDate)
	}
	if contract != nil && contract.ExpiryDate != nil {
		return normalizeMonitorDate(contract.ExpiryDate.AddDate(0, 0, -contract.RenewalNoticeDays))
	}
	return normalizeMonitorDate(time.Now())
}

func renewalSeverity(daysRemaining int) model.ComplianceSeverity {
	switch {
	case daysRemaining <= 7:
		return model.ComplianceSeverityCritical
	case daysRemaining <= 30:
		return model.ComplianceSeverityHigh
	default:
		return model.ComplianceSeverityMedium
	}
}
