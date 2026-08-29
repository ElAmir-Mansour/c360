package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/pricing/model"
)

// ErrProvisioningUnavailable is returned by ProvisionFromQuote when no license
// assigner is wired. It is a configuration error (the loop cannot close), not a
// client error; the handler maps it to 503.
var ErrProvisioningUnavailable = errors.New("license provisioning is not configured")

// LicenseAssigner is the seam through which the commercial loop closes: it binds
// a tenant to a plan and records the tenant's AI allowance. It is satisfied by a
// thin adapter over the co-located license service's AssignLicense/SetOverride
// (in-process, sharing the same DB pool) in production wiring, and is trivially
// faked in tests. Keeping it an interface means pricing does NOT import the
// license service package (no dependency cycle) and provisioning is optional
// (nil assigner -> fail-closed, never a silent no-op).
type LicenseAssigner interface {
	// AssignTierPlan binds tenantID to the given plan for [now, now+term], with
	// seats, and records the AI allowance as a metered entitlement / usage seed.
	// It is the single call that closes the loop for a quote; it MUST be
	// idempotent-safe to re-run (AssignLicense replaces the license).
	AssignTierPlan(ctx context.Context, in AssignTierPlanInput) error
}

// AssignTierPlanInput is the resolved, validated provisioning request handed to
// the license side. All governance decisions (accepted? tenant-linked? tier
// mapped?) are already made by ProvisionFromQuote before this is built.
type AssignTierPlanInput struct {
	TenantID    string
	PlanKey     string
	Seats       int64
	ExpiresAt   time.Time
	GraceDays   int
	AIAllowance model.AIAllowance
	QuoteNumber string
}

// ProvisionFromQuote closes the commercial loop for a quote linked to a tenant:
// it resolves the selected tier to a license plan and assigns that plan to the
// tenant by reusing the license AssignLicense path (via the injected assigner),
// carrying the tier's AI allowance into the plan entitlement / usage seed.
//
// It is FAIL-CLOSED. It returns:
//   - ErrNotProvisionable (wrapped) if the quote is not accepted, or has no
//     linked tenant_id, or no selected tier;
//   - ErrTierUnmapped (wrapped) if the selected tier has no mapped plan;
//   - ErrProvisioningUnavailable if no assigner is wired.
//
// On success it stages a pricing.quote.provisioned audit event and returns the
// resolved plan key. The assignment itself runs in the license service's own
// transaction (a separate, existing lifecycle); the audit event is staged in a
// pricing transaction so the loop-close is recorded on the hash-chained log.
func (s *Service) ProvisionFromQuote(ctx context.Context, quoteID, actor string) (*model.StoredQuote, string, error) {
	if s.assigner == nil {
		return nil, "", ErrProvisioningUnavailable
	}

	q, err := s.quoteRepo.GetQuoteByID(ctx, s.pool, quoteID)
	if err != nil {
		return nil, "", err
	}

	// Fail-closed governance gates, in the order the handler maps to statuses.
	if q.Status != model.QuoteStatusAccepted {
		return nil, "", fmt.Errorf("%w: quote %s is %q, only an accepted quote can be provisioned", model.ErrNotProvisionable, q.QuoteNumber, q.Status)
	}
	if q.TenantID == nil || *q.TenantID == "" {
		return nil, "", fmt.Errorf("%w: quote %s has no linked tenant_id", model.ErrNotProvisionable, q.QuoteNumber)
	}
	if q.SelectedTier == nil {
		return nil, "", fmt.Errorf("%w: quote %s has no selected tier", model.ErrNotProvisionable, q.QuoteNumber)
	}

	planKey, err := s.tierPlans.ResolvePlanKey(*q.SelectedTier)
	if err != nil {
		return nil, "", err // wraps model.ErrTierUnmapped
	}

	// Resolve the rates the quote was priced against so the AI allowance matches
	// exactly what was quoted, and derive the seat count from the model's volume
	// driver (Users on per_user, Cores on per_core).
	rates, err := s.ratesForQuote(ctx, q)
	if err != nil {
		return nil, "", err
	}
	ai := model.AIAllowanceForQuote(rates, q.Inputs, *q.SelectedTier)

	seats := q.Inputs.Users
	if q.Inputs.Model == model.ModelPerCore {
		seats = q.Inputs.Cores
	}

	term := q.Inputs.TermMonths
	if term <= 0 {
		term = 1
	}
	expiresAt := s.now().AddDate(0, term, 0)

	if err := s.assigner.AssignTierPlan(ctx, AssignTierPlanInput{
		TenantID:    *q.TenantID,
		PlanKey:     planKey,
		Seats:       seats,
		ExpiresAt:   expiresAt,
		GraceDays:   defaultProvisionGraceDays,
		AIAllowance: ai,
		QuoteNumber: q.QuoteNumber,
	}); err != nil {
		return nil, "", fmt.Errorf("assign tier plan %q to tenant %s: %w", planKey, *q.TenantID, err)
	}

	// Audit the loop close on the hash-chained pricing log (own tx).
	if err := s.runInTx(ctx, func(tx pgx.Tx) error {
		return s.stageForTenant(ctx, tx, *q.TenantID, eventQuoteProvisioned, map[string]any{
			"quote_id":       q.ID,
			"quote_number":   q.QuoteNumber,
			"tenant_id":      *q.TenantID,
			"selected_tier":  q.SelectedTier,
			"plan_key":       planKey,
			"seats":          seats,
			"term_months":    term,
			"expires_at":     expiresAt,
			"ai_allowance":   ai,
			"provisioned_by": actor,
		})
	}); err != nil {
		// The plan is assigned but the audit event failed to stage. Surface the
		// error so the caller can retry (AssignLicense is replace-idempotent, so a
		// retry re-assigns the same plan harmlessly).
		return nil, "", fmt.Errorf("stage provisioned audit event: %w", err)
	}

	s.logger.Info().
		Str("quote_number", q.QuoteNumber).
		Str("tenant_id", *q.TenantID).
		Str("plan_key", planKey).
		Int64("seats", seats).
		Bool("ai_metered", ai.Metered).
		Float64("ai_allowance_millions", ai.AllowanceMillions).
		Msg("provisioned tier plan from accepted quote")

	return q, planKey, nil
}

// defaultProvisionGraceDays is the grace window applied to a license assigned
// from an accepted quote (matches the onboarding trial default of 7).
const defaultProvisionGraceDays = 7

// ratesForQuote loads the PricingRates the quote was priced against, so the AI
// allowance carried into provisioning matches exactly what the engine quoted.
func (s *Service) ratesForQuote(ctx context.Context, q *model.StoredQuote) (model.PricingRates, error) {
	cfg, err := s.repo.GetByVersion(ctx, s.pool, q.PricingVersion)
	if err != nil {
		return model.PricingRates{}, fmt.Errorf("load pricing version %d for quote %s: %w", q.PricingVersion, q.QuoteNumber, err)
	}
	return cfg.Rates, nil
}
