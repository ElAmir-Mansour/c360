package service

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/pricing/engine"
	"github.com/clario360/platform/internal/pricing/model"
	"github.com/clario360/platform/internal/pricing/repository"
)

// Quote outbox event types (folded into the hash-chained audit log via the
// existing license event consumer).
const (
	eventQuoteCreated    = "pricing.quote_created"
	eventQuoteSent       = "pricing.quote_sent"
	eventQuoteAccepted   = "pricing.quote_accepted"
	eventQuoteRejected   = "pricing.quote_rejected"
	eventFloorOverridden = "pricing.floor_overridden"

	// eventQuoteAcceptedDomain is the RICH, decoupled commercial hand-off event
	// staged in the accept transaction alongside the generic status event. It
	// carries the full payload the onboarding/provisioning pipeline consumes.
	eventQuoteAcceptedDomain = "pricing.quote.accepted"
	// eventQuoteProvisioned is staged when the pricing:admin provision-from-quote
	// action assigns the tier plan to the linked tenant (audit of the loop close).
	eventQuoteProvisioned = "pricing.quote.provisioned"
)

// QuoteRepo abstracts the quote persistence so the service depends on an
// interface (tests substitute an in-memory implementation). It is separate from
// Repo so the config-only code paths are unaffected.
type QuoteRepo interface {
	NextQuoteNumberSeq(ctx context.Context, db repository.DBTX) (int64, error)
	InsertQuote(ctx context.Context, db repository.DBTX, q *model.StoredQuote) (*model.StoredQuote, error)
	GetQuoteByID(ctx context.Context, db repository.DBTX, id string) (*model.StoredQuote, error)
	ListQuotes(ctx context.Context, db repository.DBTX, f repository.QuoteFilter) ([]*model.StoredQuote, int, error)
	UpdateQuoteStatus(ctx context.Context, db repository.DBTX, id, status string) (*model.StoredQuote, error)
	RecordFloorOverride(ctx context.Context, db repository.DBTX, id, overrideBy string) (*model.StoredQuote, error)
}

// SetQuoteRepo attaches the quote repository. New() leaves it nil for
// config-only construction; license-service wiring passes the concrete repo
// (which satisfies both Repo and QuoteRepo).
func (s *Service) SetQuoteRepo(qr QuoteRepo) { s.quoteRepo = qr }

// --- Create ------------------------------------------------------------------

// CreateQuoteInput is the request to persist a new quote. The client supplies
// only INPUTS (+ optional commercial linkage and a selected tier) — never tier
// numbers. The server resolves the active config, RE-RUNS the engine, and stamps
// the priced-against version and a fresh quote_number.
type CreateQuoteInput struct {
	Inputs       model.Inputs
	TenantID     *string
	LeadID       *string
	AccountName  string
	SelectedTier *model.Tier
	ValidUntil   *time.Time
	CreatedBy    string
}

// CreateQuote is server-authoritative. It ignores any client-supplied tier
// numbers entirely: it loads the ACTIVE pricing_config, recomputes all four
// tiers with the pure engine, and persists that computed output. The quote is
// stamped with the exact config id + version it was priced against (immutable),
// a sequential quote_number, and status=draft. below_floor is derived from the
// selected tier's guardrail (server-side), so the governance gate cannot be
// bypassed by the client.
func (s *Service) CreateQuote(ctx context.Context, in CreateQuoteInput) (*model.StoredQuote, error) {
	if err := validateInputs(in.Inputs); err != nil {
		return nil, err
	}
	if in.SelectedTier != nil && !model.IsValidTier(*in.SelectedTier) {
		return nil, fmt.Errorf("%w: selected_tier must be one of standard/growth/professional/customized", model.ErrInvalidQuote)
	}

	cfg, err := s.repo.GetActive(ctx, s.pool)
	if err != nil {
		return nil, err
	}

	// SERVER RECOMPUTE: the stored tiers are a fresh engine.Compute against the
	// resolved config + inputs. Client tier numbers are never read.
	q := engine.Compute(cfg.Rates, in.Inputs, cfg.Version)

	// below_floor is the selected tier's guardrail, evaluated server-side. If no
	// tier is selected yet, the quote is not below-floor (nothing to gate on
	// until a tier is chosen; the send/accept gate re-checks with a selection).
	belowFloor := false
	if in.SelectedTier != nil {
		for _, t := range q.Tiers {
			if t.Tier == *in.SelectedTier && t.Internal.Guardrail == model.GuardrailBelowFloor {
				belowFloor = true
			}
		}
	}

	stored := &model.StoredQuote{
		Model:           in.Inputs.Model,
		PricingConfigID: cfg.ID,
		PricingVersion:  cfg.Version,
		TenantID:        in.TenantID,
		LeadID:          in.LeadID,
		AccountName:     in.AccountName,
		Inputs:          in.Inputs,
		ComputedTiers:   q.Tiers,
		SelectedTier:    in.SelectedTier,
		Status:          model.QuoteStatusDraft,
		BelowFloor:      belowFloor,
		ValidUntil:      in.ValidUntil,
		CreatedBy:       in.CreatedBy,
	}

	var out *model.StoredQuote
	err = s.runInTx(ctx, func(tx pgx.Tx) error {
		seq, err := s.quoteRepo.NextQuoteNumberSeq(ctx, tx)
		if err != nil {
			return err
		}
		stored.QuoteNumber = formatQuoteNumber(s.now(), seq)
		created, err := s.quoteRepo.InsertQuote(ctx, tx, stored)
		if err != nil {
			return err
		}
		if err := s.stageForTenant(ctx, tx, quoteTenant(created), eventQuoteCreated, map[string]any{
			"quote_id":        created.ID,
			"quote_number":    created.QuoteNumber,
			"model":           created.Model,
			"pricing_version": created.PricingVersion,
			"selected_tier":   created.SelectedTier,
			"below_floor":     created.BelowFloor,
			"created_by":      created.CreatedBy,
		}); err != nil {
			return err
		}
		out = created
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// formatQuoteNumber renders Q-<year>-<6-digit zero-padded sequence>.
func formatQuoteNumber(now time.Time, seq int64) string {
	return fmt.Sprintf("Q-%04d-%06d", now.Year(), seq)
}

// quoteTenant returns the tenant a quote's outbox event should be scoped to: the
// linked tenant_id when present, else "" (stageForTenant maps that to the
// platform sentinel — a quote may precede a tenant).
func quoteTenant(q *model.StoredQuote) string {
	if q != nil && q.TenantID != nil {
		return *q.TenantID
	}
	return ""
}

// --- Read --------------------------------------------------------------------

// GetQuote returns one quote (the full internal record; the handler masks by RBAC).
func (s *Service) GetQuote(ctx context.Context, id string) (*model.StoredQuote, error) {
	return s.quoteRepo.GetQuoteByID(ctx, s.pool, id)
}

// ListQuotes returns quotes matching the filter plus the total for pagination.
func (s *Service) ListQuotes(ctx context.Context, f repository.QuoteFilter) ([]*model.StoredQuote, int, error) {
	return s.quoteRepo.ListQuotes(ctx, s.pool, f)
}

// --- State machine -----------------------------------------------------------

// SendQuote transitions draft->sent. It is BLOCKED (ErrBelowFloorBlocked) when
// the selected tier is below floor and no override was recorded — re-checked
// server-side, not trusting the stored below_floor flag alone: it recomputes the
// guardrail requirement from below_floor && no floor_override_by.
func (s *Service) SendQuote(ctx context.Context, id, actor string) (*model.StoredQuote, error) {
	return s.transition(ctx, id, actor, model.QuoteStatusDraft, model.QuoteStatusSent, eventQuoteSent, true)
}

// AcceptQuote transitions sent->accepted (also gated on the floor override).
//
// Accepting a quote is the commercial hand-off point: in the SAME transaction as
// the status update it stages BOTH the generic pricing.quote_accepted status
// event (unchanged, for the audit trail) AND a rich pricing.quote.accepted
// DOMAIN event carrying the full commercial payload the onboarding/provisioning
// pipeline needs to consume ({quote_number, tenant_id/lead/account_name, model,
// selected_tier, plan_key, term_months, ai_allowance, contract_value}).
//
// This is a DECOUPLED hand-off: AcceptQuote does NOT call provisioning
// synchronously. The domain event is the seam; a consumer (or the explicit
// pricing:admin provision-from-quote action) closes the loop. Staging the event
// in the accept transaction means a rolled-back accept stages nothing.
func (s *Service) AcceptQuote(ctx context.Context, id, actor string) (*model.StoredQuote, error) {
	q, err := s.quoteRepo.GetQuoteByID(ctx, s.pool, id)
	if err != nil {
		return nil, err
	}
	if q.Status != model.QuoteStatusSent {
		return nil, fmt.Errorf("%w: %s requires status %q, quote is %q", model.ErrInvalidTransition, model.QuoteStatusAccepted, model.QuoteStatusSent, q.Status)
	}
	if q.BelowFloor && q.FloorOverrideBy == nil {
		return nil, model.ErrBelowFloorBlocked
	}

	// Resolve the plan key for the selected tier up front (outside the tx) so the
	// domain event carries a resolved plan_key when the tier maps to a plan. An
	// unmapped tier does NOT block acceptance (a quote may be accepted before the
	// tier→plan map is configured); the plan_key is simply omitted and the
	// downstream provision action fails closed instead. Same for a missing tier.
	planKey := ""
	if q.SelectedTier != nil {
		if k, err := s.tierPlans.ResolvePlanKey(*q.SelectedTier); err == nil {
			planKey = k
		}
	}

	var out *model.StoredQuote
	err = s.runInTx(ctx, func(tx pgx.Tx) error {
		updated, err := s.quoteRepo.UpdateQuoteStatus(ctx, tx, id, model.QuoteStatusAccepted)
		if err != nil {
			return err
		}
		// (1) Generic status event — unchanged, keeps the existing audit contract.
		if err := s.stageForTenant(ctx, tx, quoteTenant(updated), eventQuoteAccepted, map[string]any{
			"quote_id":     updated.ID,
			"quote_number": updated.QuoteNumber,
			"status":       updated.Status,
			"actor":        actor,
		}); err != nil {
			return err
		}
		// (2) Rich domain hand-off event — the decoupled provisioning trigger.
		if err := s.stageForTenant(ctx, tx, quoteTenant(updated), eventQuoteAcceptedDomain, s.acceptedEventPayload(ctx, updated, planKey, actor)); err != nil {
			return err
		}
		out = updated
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// acceptedEventPayload builds the decoupled hand-off payload for the
// pricing.quote.accepted domain event. tenant_id/lead_id are omitted when the
// quote is not linked; plan_key is omitted when the tier is unmapped/absent.
func (s *Service) acceptedEventPayload(ctx context.Context, q *model.StoredQuote, planKey, actor string) map[string]any {
	payload := map[string]any{
		"quote_id":      q.ID,
		"quote_number":  q.QuoteNumber,
		"account_name":  q.AccountName,
		"model":         q.Model,
		"selected_tier": q.SelectedTier,
		"term_months":   q.Inputs.TermMonths,
		"accepted_by":   actor,
	}
	if q.TenantID != nil {
		payload["tenant_id"] = *q.TenantID
	}
	if q.LeadID != nil {
		payload["lead_id"] = *q.LeadID
	}
	if planKey != "" {
		payload["plan_key"] = planKey
	}
	if it, ok := q.SelectedInternalTier(); ok {
		payload["contract_value"] = it.ContractValue
	}
	if q.SelectedTier != nil {
		if rates, err := s.ratesForQuote(ctx, q); err == nil {
			ai := model.AIAllowanceForQuote(rates, q.Inputs, *q.SelectedTier)
			payload["ai_allowance"] = ai
		}
	}
	return payload
}

// RejectQuote transitions draft|sent -> rejected. No floor gate (rejecting a
// below-floor quote is always allowed).
func (s *Service) RejectQuote(ctx context.Context, id, actor string) (*model.StoredQuote, error) {
	q, err := s.quoteRepo.GetQuoteByID(ctx, s.pool, id)
	if err != nil {
		return nil, err
	}
	if q.Status != model.QuoteStatusDraft && q.Status != model.QuoteStatusSent {
		return nil, fmt.Errorf("%w: cannot reject a quote in status %q", model.ErrInvalidTransition, q.Status)
	}
	return s.commitTransition(ctx, id, model.QuoteStatusRejected, eventQuoteRejected, actor)
}

// transition enforces the required from-status, and (when gated) the below-floor
// override gate, then commits the new status with a staged event.
func (s *Service) transition(ctx context.Context, id, actor, fromStatus, toStatus, eventType string, floorGated bool) (*model.StoredQuote, error) {
	q, err := s.quoteRepo.GetQuoteByID(ctx, s.pool, id)
	if err != nil {
		return nil, err
	}
	if q.Status != fromStatus {
		return nil, fmt.Errorf("%w: %s requires status %q, quote is %q", model.ErrInvalidTransition, toStatus, fromStatus, q.Status)
	}
	if floorGated && q.BelowFloor && q.FloorOverrideBy == nil {
		// Server-side re-check: a below-floor quote may not advance without a
		// recorded pricing:admin override.
		return nil, model.ErrBelowFloorBlocked
	}
	return s.commitTransition(ctx, id, toStatus, eventType, actor)
}

func (s *Service) commitTransition(ctx context.Context, id, toStatus, eventType, actor string) (*model.StoredQuote, error) {
	var out *model.StoredQuote
	err := s.runInTx(ctx, func(tx pgx.Tx) error {
		updated, err := s.quoteRepo.UpdateQuoteStatus(ctx, tx, id, toStatus)
		if err != nil {
			return err
		}
		if err := s.stageForTenant(ctx, tx, quoteTenant(updated), eventType, map[string]any{
			"quote_id":     updated.ID,
			"quote_number": updated.QuoteNumber,
			"status":       updated.Status,
			"actor":        actor,
		}); err != nil {
			return err
		}
		out = updated
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// OverrideFloor records a pricing:admin floor override on a below-floor quote:
// it stamps floor_override_by/at and stages an audited pricing.floor_overridden
// event through the RunInTx+outbox pattern. Callers gate this on pricing:admin
// at the route; the service records the approver id passed in.
func (s *Service) OverrideFloor(ctx context.Context, id, overrideBy string) (*model.StoredQuote, error) {
	q, err := s.quoteRepo.GetQuoteByID(ctx, s.pool, id)
	if err != nil {
		return nil, err
	}
	if !q.BelowFloor {
		// Overriding a quote that is not below floor is a no-op guard: reject so
		// an override is only ever recorded where it is meaningful and audited.
		return nil, fmt.Errorf("%w: quote %s is not below the margin floor; no override is required", model.ErrInvalidQuote, q.QuoteNumber)
	}

	var out *model.StoredQuote
	err = s.runInTx(ctx, func(tx pgx.Tx) error {
		updated, err := s.quoteRepo.RecordFloorOverride(ctx, tx, id, overrideBy)
		if err != nil {
			return err
		}
		if err := s.stageForTenant(ctx, tx, quoteTenant(updated), eventFloorOverridden, map[string]any{
			"quote_id":          updated.ID,
			"quote_number":      updated.QuoteNumber,
			"selected_tier":     updated.SelectedTier,
			"pricing_version":   updated.PricingVersion,
			"floor_override_by": overrideBy,
			"floor_override_at": updated.FloorOverrideAt,
		}); err != nil {
			return err
		}
		out = updated
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
