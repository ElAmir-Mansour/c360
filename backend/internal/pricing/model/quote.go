package model

import (
	"errors"
	"time"
)

// Quote status lifecycle. A quote is created as a draft, sent to a prospect,
// then accepted or rejected; it expires when its validity window elapses.
const (
	QuoteStatusDraft    = "draft"
	QuoteStatusSent     = "sent"
	QuoteStatusAccepted = "accepted"
	QuoteStatusRejected = "rejected"
	QuoteStatusExpired  = "expired"
)

// Quote-specific sentinel errors, mapped to HTTP statuses by the handler.
var (
	// ErrInvalidTransition is returned when a status change is not allowed by
	// the state machine (e.g. accept a draft, send an accepted quote).
	ErrInvalidTransition = errors.New("invalid quote status transition")
	// ErrBelowFloorBlocked is returned when a below-floor quote is sent/accepted
	// without a recorded pricing:admin floor override.
	ErrBelowFloorBlocked = errors.New("quote is below the margin floor and requires a pricing:admin override before it can be sent or accepted")
	// ErrNoSelectedTier is returned when a governance check needs a selected tier
	// but the quote has none.
	ErrNoSelectedTier = errors.New("quote has no selected tier")
	// ErrInvalidQuote covers malformed quote inputs (bad tier/status/format).
	ErrInvalidQuote = errors.New("invalid quote")
	// ErrTierUnmapped is returned by the commercial loop when a tier has no
	// mapped license plan (fail-closed: provisioning refuses rather than
	// silently assigning nothing or a default plan).
	ErrTierUnmapped = errors.New("tier has no mapped license plan")
	// ErrNotProvisionable is returned by provision-from-quote when a quote is not
	// in a state that can be provisioned: it is not accepted, or it has no linked
	// tenant_id. Mapped to 409 (not-accepted) / 422 (no tenant) by the handler.
	ErrNotProvisionable = errors.New("quote cannot be provisioned")
)

// StoredQuote is the internal persistence shape of a quote. The computed tiers
// are stored WITH their internal margin blocks (this row is internal-only); the
// handler and exporter mask by DTO shape. Nullable commercial-linkage fields use
// pointers so a quote may precede a tenant/lead.
type StoredQuote struct {
	ID              string         `json:"id"`
	QuoteNumber     string         `json:"quote_number"`
	Model           Model          `json:"model"`
	PricingConfigID string         `json:"pricing_config_id"`
	PricingVersion  int            `json:"pricing_version"`
	TenantID        *string        `json:"tenant_id,omitempty"`
	LeadID          *string        `json:"lead_id,omitempty"`
	AccountName     string         `json:"account_name"`
	Inputs          Inputs         `json:"inputs"`
	ComputedTiers   []InternalTier `json:"computed_tiers"`
	SelectedTier    *Tier          `json:"selected_tier,omitempty"`
	Status          string         `json:"status"`
	BelowFloor      bool           `json:"below_floor"`
	FloorOverrideBy *string        `json:"floor_override_by,omitempty"`
	FloorOverrideAt *time.Time     `json:"floor_override_at,omitempty"`
	ValidUntil      *time.Time     `json:"valid_until,omitempty"`
	CreatedBy       string         `json:"created_by"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
}

// SelectedInternalTier returns the internal tier matching SelectedTier, or false
// if there is no selection or it is not present in the computed set.
func (q *StoredQuote) SelectedInternalTier() (InternalTier, bool) {
	if q.SelectedTier == nil {
		return InternalTier{}, false
	}
	for _, t := range q.ComputedTiers {
		if t.Tier == *q.SelectedTier {
			return t, true
		}
	}
	return InternalTier{}, false
}

// ClientTiers returns the masked (client-facing) view of the computed tiers.
func (q *StoredQuote) ClientTiers() []ClientTier {
	out := make([]ClientTier, len(q.ComputedTiers))
	for i, t := range q.ComputedTiers {
		out[i] = t.Client()
	}
	return out
}

// ClientView is the masked, client-facing serialization of a stored quote. The
// internal margin block is PHYSICALLY ABSENT (ComputedTiers is []ClientTier), so
// margin can never appear in a response served from this type even if the JSON
// serializer misbehaved. Governance flags (below_floor / floor_override_*) are
// also omitted from the client view.
type ClientView struct {
	ID             string       `json:"id"`
	QuoteNumber    string       `json:"quote_number"`
	Model          Model        `json:"model"`
	PricingVersion int          `json:"pricing_version"`
	TenantID       *string      `json:"tenant_id,omitempty"`
	LeadID         *string      `json:"lead_id,omitempty"`
	AccountName    string       `json:"account_name"`
	Inputs         Inputs       `json:"inputs"`
	Tiers          []ClientTier `json:"tiers"`
	SelectedTier   *Tier        `json:"selected_tier,omitempty"`
	Status         string       `json:"status"`
	Currency       string       `json:"currency"`
	ValidUntil     *time.Time   `json:"valid_until,omitempty"`
	CreatedAt      time.Time    `json:"created_at"`
	UpdatedAt      time.Time    `json:"updated_at"`
}

// Client returns the masked view of a stored quote for a client-facing response
// (pricing:read / pricing:write callers). Masking is by construction: Tiers is a
// []ClientTier built from t.Client(), so the internal block cannot reach it.
func (q *StoredQuote) Client() ClientView {
	return ClientView{
		ID:             q.ID,
		QuoteNumber:    q.QuoteNumber,
		Model:          q.Model,
		PricingVersion: q.PricingVersion,
		TenantID:       q.TenantID,
		LeadID:         q.LeadID,
		AccountName:    q.AccountName,
		Inputs:         q.Inputs,
		Tiers:          q.ClientTiers(),
		SelectedTier:   q.SelectedTier,
		Status:         q.Status,
		Currency:       "SAR",
		ValidUntil:     q.ValidUntil,
		CreatedAt:      q.CreatedAt,
		UpdatedAt:      q.UpdatedAt,
	}
}

// IsValidTier reports whether t is one of the four commercial tiers.
func IsValidTier(t Tier) bool {
	switch t {
	case TierStandard, TierGrowth, TierProfessional, TierCustomized:
		return true
	}
	return false
}

// AIAllowance is the monthly AI token allowance the commercial loop carries from
// an accepted quote into the assigned plan's entitlement / usage seed. Metered
// tiers (standard/growth/professional) grant a CAPPED allowance (in millions of
// tokens); Customized grants a DEDICATED allowance that is uncapped for metering
// (a NULL entitlement limit) but records the dedicated infra cost for reference.
type AIAllowance struct {
	Tier Tier `json:"tier"`
	// Metered is true for the capped tiers (a finite monthly quota applies) and
	// false for Customized (uncapped / dedicated infra — no metering limit).
	Metered bool `json:"metered"`
	// AllowanceMillions is the monthly quota in millions of tokens for a metered
	// tier (allowance-per-unit * units). Zero and meaningless when Metered=false.
	AllowanceMillions float64 `json:"allowance_millions"`
	// DedicatedCost is the flat monthly dedicated AI infra cost for Customized
	// (the ai_dedicated_cost rate). Zero for metered tiers.
	DedicatedCost float64 `json:"dedicated_cost,omitempty"`
}

// AIAllowanceForQuote derives the accepted quote's monthly AI allowance from the
// pricing rates it was priced against and its inputs/selected tier. It is the
// single source of truth for the loop's AI-allowance figure so the entitlement /
// usage seed matches exactly what the engine priced. rates is the resolved
// PricingRates of the quote's pricing version.
//
// units is the model's volume driver (Users on per_user, Cores on per_core) —
// the same quantity the engine multiplies the per-unit allowance by.
func AIAllowanceForQuote(rates PricingRates, in Inputs, tier Tier) AIAllowance {
	var units int64
	if in.Model == ModelPerCore {
		units = in.Cores
	} else {
		units = in.Users
	}
	if perUnit, capped := rates.AIAllowanceMillions.For(tier); capped {
		return AIAllowance{
			Tier:              tier,
			Metered:           true,
			AllowanceMillions: perUnit * float64(units),
		}
	}
	// Customized (or any non-capped tier): dedicated, uncapped for metering.
	return AIAllowance{
		Tier:          tier,
		Metered:       false,
		DedicatedCost: rates.AIDedicatedCost,
	}
}
