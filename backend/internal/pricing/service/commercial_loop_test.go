package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/pricing/model"
)

// --- (1) Tier -> plan mapping (fail-closed) ----------------------------------

func TestTierPlanMap_ResolvesEachTier(t *testing.T) {
	m := DefaultTierPlanMap()
	cases := map[model.Tier]string{
		model.TierStandard:     "standard",
		model.TierGrowth:       "growth",
		model.TierProfessional: "professional",
		model.TierCustomized:   "customized",
	}
	for tier, want := range cases {
		got, err := m.ResolvePlanKey(tier)
		if err != nil {
			t.Fatalf("ResolvePlanKey(%q): %v", tier, err)
		}
		if got != want {
			t.Errorf("ResolvePlanKey(%q) = %q, want %q", tier, got, want)
		}
	}
	if err := m.Validate(); err != nil {
		t.Errorf("DefaultTierPlanMap should validate: %v", err)
	}
}

func TestTierPlanMap_UnmappedTierFailsClosed(t *testing.T) {
	// A map missing a tier fails closed with ErrTierUnmapped, not a silent "".
	m := TierPlanMap{
		model.TierStandard:     "standard",
		model.TierGrowth:       "growth",
		model.TierProfessional: "professional",
		// customized intentionally absent
	}
	if _, err := m.ResolvePlanKey(model.TierCustomized); !errors.Is(err, model.ErrTierUnmapped) {
		t.Fatalf("unmapped tier should be ErrTierUnmapped, got %v", err)
	}
	if err := m.Validate(); !errors.Is(err, model.ErrTierUnmapped) {
		t.Fatalf("Validate on incomplete map should be ErrTierUnmapped, got %v", err)
	}
	// An empty plan key is also fail-closed.
	m2 := DefaultTierPlanMap()
	m2[model.TierGrowth] = ""
	if _, err := m2.ResolvePlanKey(model.TierGrowth); !errors.Is(err, model.ErrTierUnmapped) {
		t.Fatalf("empty plan key should be ErrTierUnmapped, got %v", err)
	}
	// An invalid tier value is fail-closed.
	if _, err := DefaultTierPlanMap().ResolvePlanKey(model.Tier("bogus")); !errors.Is(err, model.ErrTierUnmapped) {
		t.Fatalf("bogus tier should be ErrTierUnmapped, got %v", err)
	}
}

func TestSetTierPlanMap_RejectsIncomplete(t *testing.T) {
	m := newInMem(activeDefaultConfig())
	s, _ := newQuoteService(m)
	if err := s.SetTierPlanMap(TierPlanMap{model.TierStandard: "standard"}); !errors.Is(err, model.ErrTierUnmapped) {
		t.Fatalf("SetTierPlanMap should reject an incomplete map, got %v", err)
	}
	// The default (installed by newQuoteService) must still resolve after a
	// rejected override — the map was not mutated.
	if k, err := s.tierPlans.ResolvePlanKey(model.TierCustomized); err != nil || k != "customized" {
		t.Fatalf("rejected SetTierPlanMap must not mutate the map: got %q err=%v", k, err)
	}
}

// --- (2) Accept -> rich domain event in the SAME tx --------------------------

// eventStaged reports whether the tx staged an event whose normalized type ends
// with the given suffix (types are normalized to com.clario360.<type>). It
// returns the event's DATA payload (the domain fields), unwrapped from the
// CloudEvents envelope the outbox stores.
func eventStaged(tx *fakeTx, suffix string) (map[string]any, bool) {
	for i, et := range tx.stagedEvents {
		if et == suffix || strings.HasSuffix(et, "."+suffix) {
			var envelope struct {
				Data map[string]any `json:"data"`
			}
			if err := json.Unmarshal(tx.stagedPayloads[i], &envelope); err != nil {
				return nil, true
			}
			return envelope.Data, true
		}
	}
	return nil, false
}

func TestAcceptQuote_StagesRichDomainEvent(t *testing.T) {
	m := newInMem(activeDefaultConfig())
	s, tx := newQuoteService(m)

	tenant := "aaaaaaaa-0000-0000-0000-000000000009"
	q, err := s.CreateQuote(context.Background(), CreateQuoteInput{
		Inputs:       stdInputs(),
		TenantID:     &tenant,
		AccountName:  "Acme",
		SelectedTier: tierPtr(model.TierGrowth),
		CreatedBy:    "u1",
	})
	if err != nil {
		t.Fatalf("CreateQuote: %v", err)
	}
	if _, err := s.SendQuote(context.Background(), q.ID, "u1"); err != nil {
		t.Fatalf("SendQuote: %v", err)
	}
	// Reset capture so we only inspect the accept transaction's staged events.
	tx.stagedEvents = nil
	tx.stagedPayloads = nil

	if _, err := s.AcceptQuote(context.Background(), q.ID, "closer"); err != nil {
		t.Fatalf("AcceptQuote: %v", err)
	}

	// Both the generic status event AND the rich domain event are staged.
	if _, ok := eventStaged(tx, "pricing.quote_accepted"); !ok {
		t.Errorf("expected generic pricing.quote_accepted event; got %v", tx.stagedEvents)
	}
	got, ok := eventStaged(tx, "pricing.quote.accepted")
	if !ok {
		t.Fatalf("expected rich pricing.quote.accepted domain event; got %v", tx.stagedEvents)
	}
	// The hand-off payload carries the loop essentials.
	if got["quote_number"] != q.QuoteNumber {
		t.Errorf("quote_number: got %v, want %s", got["quote_number"], q.QuoteNumber)
	}
	if got["tenant_id"] != tenant {
		t.Errorf("tenant_id: got %v, want %s", got["tenant_id"], tenant)
	}
	if got["plan_key"] != "growth" {
		t.Errorf("plan_key: got %v, want growth", got["plan_key"])
	}
	if got["selected_tier"] != "growth" {
		t.Errorf("selected_tier: got %v, want growth", got["selected_tier"])
	}
	if _, ok := got["term_months"]; !ok {
		t.Errorf("term_months missing from hand-off payload: %v", got)
	}
	if _, ok := got["contract_value"]; !ok {
		t.Errorf("contract_value missing from hand-off payload: %v", got)
	}
	// AI allowance is carried into the hand-off event (item 4).
	ai, ok := got["ai_allowance"].(map[string]any)
	if !ok {
		t.Fatalf("ai_allowance missing/wrong shape: %v", got["ai_allowance"])
	}
	if ai["metered"] != true {
		t.Errorf("growth tier ai_allowance should be metered: %v", ai)
	}
	// growth = 5M per unit * 1 user = 5.
	if ai["allowance_millions"].(float64) != 5 {
		t.Errorf("growth ai allowance: got %v, want 5", ai["allowance_millions"])
	}
}

// TestAcceptQuote_RolledBackStagesNothing: when the accept transaction fails
// (rolls back), NO event is durably staged — the event and the status change
// commit atomically. We simulate a rollback by making the tx runner return an
// error after fn runs; the captured events are discarded by the caller because
// AcceptQuote returns the error and no commit happens.
func TestAcceptQuote_RolledBackStagesNothing(t *testing.T) {
	m := newInMem(activeDefaultConfig())
	s, _ := newQuoteService(m)

	q, err := s.CreateQuote(context.Background(), CreateQuoteInput{
		Inputs:       stdInputs(),
		SelectedTier: tierPtr(model.TierStandard),
		CreatedBy:    "u1",
	})
	if err != nil {
		t.Fatalf("CreateQuote: %v", err)
	}
	if _, err := s.SendQuote(context.Background(), q.ID, "u1"); err != nil {
		t.Fatalf("SendQuote: %v", err)
	}

	// Model a rollback: the runner runs fn (so events are staged into the tx's
	// buffer) but returns an error WITHOUT "committing" them to the durable log.
	// durable holds only the events a committed tx would flush; a rolled-back tx
	// flushes nothing. This mirrors database.RunInTx, where staged outbox rows
	// are only visible after COMMIT.
	boom := errors.New("commit failed")
	var durable []string
	s.runInTx = func(ctx context.Context, fn func(tx pgx.Tx) error) error {
		tx := &fakeTx{}
		if err := fn(tx); err != nil {
			return err
		}
		// Simulate the commit failing: do NOT flush tx.stagedEvents to durable.
		return boom
	}

	if _, err := s.AcceptQuote(context.Background(), q.ID, "u1"); !errors.Is(err, boom) {
		t.Fatalf("AcceptQuote should surface the tx error, got %v", err)
	}
	// Because the accept transaction rolled back, no domain event was durably
	// staged: the status update and BOTH accept events commit atomically or not
	// at all.
	if len(durable) != 0 {
		t.Fatalf("a rolled-back accept must stage nothing durably, got %v", durable)
	}
}

// --- (3) Provision-from-quote (fail-closed + reuse AssignLicense) ------------

// fakeAssigner records the AssignTierPlanInput it received.
type fakeAssigner struct {
	called bool
	last   AssignTierPlanInput
	err    error
}

func (f *fakeAssigner) AssignTierPlan(ctx context.Context, in AssignTierPlanInput) error {
	f.called = true
	f.last = in
	return f.err
}

func acceptedTenantQuote(t *testing.T, s *Service, tenant string, tier model.Tier, in model.Inputs) *model.StoredQuote {
	t.Helper()
	q, err := s.CreateQuote(context.Background(), CreateQuoteInput{
		Inputs:       in,
		TenantID:     &tenant,
		AccountName:  "Acme",
		SelectedTier: tierPtr(tier),
		CreatedBy:    "u1",
	})
	if err != nil {
		t.Fatalf("CreateQuote: %v", err)
	}
	if _, err := s.SendQuote(context.Background(), q.ID, "u1"); err != nil {
		t.Fatalf("SendQuote: %v", err)
	}
	if _, err := s.AcceptQuote(context.Background(), q.ID, "u1"); err != nil {
		t.Fatalf("AcceptQuote: %v", err)
	}
	return q
}

func TestProvisionFromQuote_AssignsPlanForTenantLinkedAcceptedQuote(t *testing.T) {
	m := newInMem(activeDefaultConfig())
	s, _ := newQuoteService(m)
	fa := &fakeAssigner{}
	s.SetLicenseAssigner(fa)

	tenant := "aaaaaaaa-0000-0000-0000-000000000009"
	// per_user, 3 users, professional (10M/unit) => 30M allowance, seats=3.
	in := model.Inputs{Model: model.ModelPerUser, Deployment: model.DeploymentSaaS, TermMonths: 12, Users: 3, HotStorageGB: 1, ColdStorageGB: 1}
	q := acceptedTenantQuote(t, s, tenant, model.TierProfessional, in)

	out, planKey, err := s.ProvisionFromQuote(context.Background(), q.ID, "admin-1")
	if err != nil {
		t.Fatalf("ProvisionFromQuote: %v", err)
	}
	if planKey != "professional" {
		t.Errorf("planKey: got %q, want professional", planKey)
	}
	if out.ID != q.ID {
		t.Errorf("returned quote id mismatch")
	}
	if !fa.called {
		t.Fatal("AssignTierPlan was not called — the loop did not reuse AssignLicense")
	}
	if fa.last.TenantID != tenant {
		t.Errorf("assigned tenant: got %q, want %q", fa.last.TenantID, tenant)
	}
	if fa.last.PlanKey != "professional" {
		t.Errorf("assigned plan_key: got %q, want professional", fa.last.PlanKey)
	}
	if fa.last.Seats != 3 {
		t.Errorf("seats: got %d, want 3 (per_user users)", fa.last.Seats)
	}
	// (4) AI allowance carried into the assignment: 10M * 3 units = 30M, metered.
	if !fa.last.AIAllowance.Metered {
		t.Errorf("professional AI allowance should be metered: %+v", fa.last.AIAllowance)
	}
	if fa.last.AIAllowance.AllowanceMillions != 30 {
		t.Errorf("AI allowance millions: got %v, want 30", fa.last.AIAllowance.AllowanceMillions)
	}
	if fa.last.ExpiresAt.IsZero() || !fa.last.ExpiresAt.After(fixedNow()) {
		t.Errorf("expires_at should be in the future: %v", fa.last.ExpiresAt)
	}
}

func TestProvisionFromQuote_CustomizedCarriesUncappedAllowance(t *testing.T) {
	m := newInMem(activeDefaultConfig())
	s, _ := newQuoteService(m)
	fa := &fakeAssigner{}
	s.SetLicenseAssigner(fa)

	tenant := "aaaaaaaa-0000-0000-0000-000000000009"
	in := model.Inputs{Model: model.ModelPerUser, Deployment: model.DeploymentSaaS, TermMonths: 12, Users: 4, HotStorageGB: 1, ColdStorageGB: 1}
	q := acceptedTenantQuote(t, s, tenant, model.TierCustomized, in)

	_, planKey, err := s.ProvisionFromQuote(context.Background(), q.ID, "admin-1")
	if err != nil {
		t.Fatalf("ProvisionFromQuote(customized): %v", err)
	}
	if planKey != "customized" {
		t.Errorf("planKey: got %q, want customized", planKey)
	}
	// Customized: uncapped (not metered), dedicated cost carried.
	if fa.last.AIAllowance.Metered {
		t.Errorf("customized AI allowance must be uncapped (not metered): %+v", fa.last.AIAllowance)
	}
	if fa.last.AIAllowance.DedicatedCost != model.DefaultConfig().AIDedicatedCost {
		t.Errorf("customized dedicated cost: got %v, want %v", fa.last.AIAllowance.DedicatedCost, model.DefaultConfig().AIDedicatedCost)
	}
}

func TestProvisionFromQuote_RejectsNonAccepted(t *testing.T) {
	m := newInMem(activeDefaultConfig())
	s, _ := newQuoteService(m)
	fa := &fakeAssigner{}
	s.SetLicenseAssigner(fa)

	tenant := "aaaaaaaa-0000-0000-0000-000000000009"
	// Draft (never sent/accepted).
	q, err := s.CreateQuote(context.Background(), CreateQuoteInput{
		Inputs:       stdInputs(),
		TenantID:     &tenant,
		SelectedTier: tierPtr(model.TierStandard),
		CreatedBy:    "u1",
	})
	if err != nil {
		t.Fatalf("CreateQuote: %v", err)
	}
	if _, _, err := s.ProvisionFromQuote(context.Background(), q.ID, "admin-1"); !errors.Is(err, model.ErrNotProvisionable) {
		t.Fatalf("provisioning a draft should be ErrNotProvisionable, got %v", err)
	}
	if fa.called {
		t.Error("AssignTierPlan must not be called for a non-accepted quote (fail-closed)")
	}
}

func TestProvisionFromQuote_RejectsTenantless(t *testing.T) {
	m := newInMem(activeDefaultConfig())
	s, _ := newQuoteService(m)
	fa := &fakeAssigner{}
	s.SetLicenseAssigner(fa)

	// Accepted but NO tenant_id linked.
	q, err := s.CreateQuote(context.Background(), CreateQuoteInput{
		Inputs:       stdInputs(),
		SelectedTier: tierPtr(model.TierStandard),
		CreatedBy:    "u1",
	})
	if err != nil {
		t.Fatalf("CreateQuote: %v", err)
	}
	if _, err := s.SendQuote(context.Background(), q.ID, "u1"); err != nil {
		t.Fatalf("SendQuote: %v", err)
	}
	if _, err := s.AcceptQuote(context.Background(), q.ID, "u1"); err != nil {
		t.Fatalf("AcceptQuote: %v", err)
	}
	if _, _, err := s.ProvisionFromQuote(context.Background(), q.ID, "admin-1"); !errors.Is(err, model.ErrNotProvisionable) {
		t.Fatalf("provisioning a tenant-less quote should be ErrNotProvisionable, got %v", err)
	}
	if fa.called {
		t.Error("AssignTierPlan must not be called for a tenant-less quote (fail-closed)")
	}
}

func TestProvisionFromQuote_RejectsUnmappedTier(t *testing.T) {
	m := newInMem(activeDefaultConfig())
	s, _ := newQuoteService(m)
	fa := &fakeAssigner{}
	s.SetLicenseAssigner(fa)

	tenant := "aaaaaaaa-0000-0000-0000-000000000009"
	q := acceptedTenantQuote(t, s, tenant, model.TierGrowth, stdInputs())

	// Remap so growth has no plan (directly, bypassing SetTierPlanMap's guard) to
	// model a config gap discovered only at provision time.
	s.tierPlans = TierPlanMap{
		model.TierStandard:     "standard",
		model.TierGrowth:       "", // unmapped
		model.TierProfessional: "professional",
		model.TierCustomized:   "customized",
	}
	if _, _, err := s.ProvisionFromQuote(context.Background(), q.ID, "admin-1"); !errors.Is(err, model.ErrTierUnmapped) {
		t.Fatalf("unmapped tier at provision should be ErrTierUnmapped, got %v", err)
	}
	if fa.called {
		t.Error("AssignTierPlan must not be called when the tier is unmapped (fail-closed)")
	}
}

func TestProvisionFromQuote_UnavailableWhenNoAssigner(t *testing.T) {
	m := newInMem(activeDefaultConfig())
	s, _ := newQuoteService(m) // no assigner wired
	tenant := "aaaaaaaa-0000-0000-0000-000000000009"
	q := acceptedTenantQuote(t, s, tenant, model.TierStandard, stdInputs())
	if _, _, err := s.ProvisionFromQuote(context.Background(), q.ID, "admin-1"); !errors.Is(err, ErrProvisioningUnavailable) {
		t.Fatalf("no assigner should be ErrProvisioningUnavailable, got %v", err)
	}
}
