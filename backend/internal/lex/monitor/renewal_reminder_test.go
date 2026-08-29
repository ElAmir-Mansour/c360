package monitor

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/lex/model"
)

// capturingPublisher records every event published so renewal-reminder tests
// can assert on the alert_created emissions without a live broker.
type capturingPublisher struct {
	mu     sync.Mutex
	events []*events.Event
}

func (p *capturingPublisher) Publish(_ context.Context, _ string, event *events.Event) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events = append(p.events, event)
	return nil
}

func (p *capturingPublisher) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.events)
}

// dedupAlertStore is an in-memory stand-in for the AlertRepository's
// dedup-aware insert. It models the partial unique index on
// (tenant_id, dedup_key) WHERE status NOT IN ('resolved','dismissed'): an
// insert is skipped when an *open* alert with the same key already exists.
type dedupAlertStore struct {
	mu       sync.Mutex
	open     map[string]uuid.UUID // dedup key -> alert id
	inserted []*model.ComplianceAlert
	failNext bool
}

func newDedupAlertStore() *dedupAlertStore {
	return &dedupAlertStore{open: make(map[string]uuid.UUID)}
}

func (s *dedupAlertStore) create(_ context.Context, alert *model.ComplianceAlert) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failNext {
		s.failNext = false
		return false, errors.New("simulated alert insert failure")
	}
	if alert.DedupKey != nil {
		if _, exists := s.open[*alert.DedupKey]; exists {
			return false, nil
		}
		s.open[*alert.DedupKey] = alert.ID
	}
	s.inserted = append(s.inserted, alert)
	return true, nil
}

// resolve removes an open alert by dedup key, mimicking an operator resolving
// or dismissing it (which drops it out of the partial unique index).
func (s *dedupAlertStore) resolve(dedupKey string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.open, dedupKey)
}

func (s *dedupAlertStore) insertedCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.inserted)
}

func fixedClock(t time.Time) func() time.Time {
	return func() time.Time { return t }
}

// testRenewalContract builds an auto-renewing active contract whose expiry is
// expiryOffset days from the 2026-03-07 reference date and that uses the given
// renewal-notice window.
func testRenewalContract(title string, expiryOffset, noticeDays int) model.Contract {
	expiryDate := time.Date(2026, time.March, 7, 0, 0, 0, 0, time.UTC).AddDate(0, 0, expiryOffset)
	return model.Contract{
		ID:                uuid.New(),
		TenantID:          uuid.New(),
		Title:             title,
		PartyBName:        "Counterparty",
		ExpiryDate:        &expiryDate,
		AutoRenew:         true,
		RenewalNoticeDays: noticeDays,
		Status:            model.ContractStatusActive,
		OwnerName:         "Owner User",
		Type:              model.ContractTypeServiceAgreement,
	}
}

func newTestRenewalReminder(now time.Time, list func(context.Context) ([]model.Contract, error), create func(context.Context, *model.ComplianceAlert) (bool, error), publisher *capturingPublisher) *RenewalReminder {
	return &RenewalReminder{
		publisher:       publisher,
		topic:           "platform.lex.events",
		logger:          zerolog.Nop(),
		now:             fixedClock(now),
		listDueFunc:     list,
		createAlertFunc: create,
	}
}

func TestRenewalReminder_RunOnce(t *testing.T) {
	reference := time.Date(2026, time.March, 7, 9, 0, 0, 0, time.UTC)

	tests := []struct {
		name            string
		contracts       []model.Contract
		wantInserted    int
		wantEvents      int
		wantSeverity    model.ComplianceSeverity
		wantSeverityFor string // contract title to assert severity on; empty to skip
	}{
		{
			name: "happy path fires at lead time",
			// Expiry in 30 days, 25-day notice => reminder date is 5 days out,
			// which is within the 7-day look-ahead window.
			contracts:       []model.Contract{testRenewalContract("Within lead window", 30, 25)},
			wantInserted:    1,
			wantEvents:      1,
			wantSeverity:    model.ComplianceSeverityHigh, // 30 days remaining
			wantSeverityFor: "Within lead window",
		},
		{
			name: "zero notice days fires inside final week",
			// Expiry in 4 days, zero notice => reminder date == expiry date,
			// which is <= today+7 and not yet past, so it must fire.
			contracts:       []model.Contract{testRenewalContract("Zero notice", 4, 0)},
			wantInserted:    1,
			wantEvents:      1,
			wantSeverity:    model.ComplianceSeverityCritical, // 4 days remaining
			wantSeverityFor: "Zero notice",
		},
		{
			name: "no-op when reminder still beyond look-ahead",
			// Expiry in 200 days, 30-day notice => reminder date is 170 days
			// out, far beyond the 7-day window: nothing is due.
			contracts:    []model.Contract{testRenewalContract("Far future", 200, 30)},
			wantInserted: 0,
			wantEvents:   0,
		},
		{
			name:         "no-op when nothing returned",
			contracts:    nil,
			wantInserted: 0,
			wantEvents:   0,
		},
		{
			name: "skips already expired contract",
			// Expiry 3 days in the past => guard drops it even though the
			// reminder date is within the window.
			contracts:    []model.Contract{testRenewalContract("Already expired", -3, 30)},
			wantInserted: 0,
			wantEvents:   0,
		},
		{
			name: "skips non auto-renew contract",
			contracts: []model.Contract{func() model.Contract {
				c := testRenewalContract("Manual renew", 4, 0)
				c.AutoRenew = false
				return c
			}()},
			wantInserted: 0,
			wantEvents:   0,
		},
		{
			name: "skips inactive contract",
			contracts: []model.Contract{func() model.Contract {
				c := testRenewalContract("Draft contract", 4, 0)
				c.Status = model.ContractStatusDraft
				return c
			}()},
			wantInserted: 0,
			wantEvents:   0,
		},
		{
			name: "skips contract without expiry date",
			contracts: []model.Contract{func() model.Contract {
				c := testRenewalContract("No expiry", 4, 0)
				c.ExpiryDate = nil
				return c
			}()},
			wantInserted: 0,
			wantEvents:   0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := newDedupAlertStore()
			publisher := &capturingPublisher{}
			contracts := tt.contracts
			reminder := newTestRenewalReminder(reference,
				func(context.Context) ([]model.Contract, error) { return contracts, nil },
				store.create,
				publisher,
			)

			if err := reminder.RunOnce(context.Background()); err != nil {
				t.Fatalf("RunOnce() error = %v", err)
			}

			if got := store.insertedCount(); got != tt.wantInserted {
				t.Fatalf("inserted alerts = %d, want %d", got, tt.wantInserted)
			}
			if got := publisher.count(); got != tt.wantEvents {
				t.Fatalf("published events = %d, want %d", got, tt.wantEvents)
			}
			if tt.wantSeverityFor != "" {
				found := false
				for _, alert := range store.inserted {
					if alert.Title == "قرار التجديد مطلوب للعقد «"+tt.wantSeverityFor+"»" {
						found = true
						if alert.Severity != tt.wantSeverity {
							t.Fatalf("severity = %q, want %q", alert.Severity, tt.wantSeverity)
						}
					}
				}
				if !found {
					t.Fatalf("expected an alert for %q to be inserted", tt.wantSeverityFor)
				}
			}
		})
	}
}

// TestRenewalReminder_ExpiryWarningRuleGate verifies the three-case gate on
// the tenant's expiry_warning rule: disabled suppresses the compliance alert,
// enabled overrides the days-remaining severity ladder and stamps the rule id,
// and a tenant without a rule keeps the legacy ladder behavior.
func TestRenewalReminder_ExpiryWarningRuleGate(t *testing.T) {
	reference := time.Date(2026, time.March, 7, 9, 0, 0, 0, time.UTC)
	ruleID := uuid.New()

	tests := []struct {
		name         string
		rule         *model.ComplianceRule
		wantInserted int
		wantSeverity model.ComplianceSeverity
		wantRuleID   *uuid.UUID
	}{
		{
			name:         "disabled rule suppresses the alert",
			rule:         &model.ComplianceRule{ID: ruleID, RuleType: model.ComplianceRuleExpiryWarning, Severity: model.ComplianceSeverityHigh, Enabled: false},
			wantInserted: 0,
		},
		{
			name:         "enabled rule overrides severity and stamps rule id",
			rule:         &model.ComplianceRule{ID: ruleID, RuleType: model.ComplianceRuleExpiryWarning, Severity: model.ComplianceSeverityLow, Enabled: true},
			wantInserted: 1,
			wantSeverity: model.ComplianceSeverityLow, // rule severity, not the ladder's high
			wantRuleID:   &ruleID,
		},
		{
			name:         "no rule keeps ladder severity",
			rule:         nil,
			wantInserted: 1,
			wantSeverity: model.ComplianceSeverityHigh, // 30 days remaining
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			contract := testRenewalContract("Rule gated", 30, 25)
			store := newDedupAlertStore()
			publisher := &capturingPublisher{}
			reminder := newTestRenewalReminder(reference,
				func(context.Context) ([]model.Contract, error) { return []model.Contract{contract}, nil },
				store.create,
				publisher,
			)
			reminder.expiryRules = newExpiryRuleCache(func(context.Context, uuid.UUID) (*model.ComplianceRule, error) {
				return tt.rule, nil
			}, zerolog.Nop())

			if err := reminder.RunOnce(context.Background()); err != nil {
				t.Fatalf("RunOnce() error = %v", err)
			}
			if got := store.insertedCount(); got != tt.wantInserted {
				t.Fatalf("inserted alerts = %d, want %d", got, tt.wantInserted)
			}
			if got := publisher.count(); got != tt.wantInserted {
				t.Fatalf("published events = %d, want %d", got, tt.wantInserted)
			}
			if tt.wantInserted == 1 {
				alert := store.inserted[0]
				if alert.Severity != tt.wantSeverity {
					t.Fatalf("severity = %q, want %q", alert.Severity, tt.wantSeverity)
				}
				if tt.wantRuleID == nil {
					if alert.RuleID != nil {
						t.Fatalf("rule id = %v, want nil", alert.RuleID)
					}
				} else if alert.RuleID == nil || *alert.RuleID != *tt.wantRuleID {
					t.Fatalf("rule id = %v, want %s", alert.RuleID, *tt.wantRuleID)
				}
			}
		})
	}
}

// TestRenewalReminder_RuleLookupCachedPerTenant verifies the rule lookup runs
// once per tenant per iteration, not once per contract.
func TestRenewalReminder_RuleLookupCachedPerTenant(t *testing.T) {
	reference := time.Date(2026, time.March, 7, 9, 0, 0, 0, time.UTC)
	tenantID := uuid.New()
	first := testRenewalContract("Tenant contract A", 30, 25)
	second := testRenewalContract("Tenant contract B", 20, 15)
	first.TenantID = tenantID
	second.TenantID = tenantID

	lookups := 0
	store := newDedupAlertStore()
	publisher := &capturingPublisher{}
	reminder := newTestRenewalReminder(reference,
		func(context.Context) ([]model.Contract, error) { return []model.Contract{first, second}, nil },
		store.create,
		publisher,
	)
	reminder.expiryRules = newExpiryRuleCache(func(context.Context, uuid.UUID) (*model.ComplianceRule, error) {
		lookups++
		return nil, nil
	}, zerolog.Nop())

	if err := reminder.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if got := store.insertedCount(); got != 2 {
		t.Fatalf("inserted alerts = %d, want 2", got)
	}
	if lookups != 1 {
		t.Fatalf("rule lookups = %d, want 1 (cached per tenant per run)", lookups)
	}
}

// TestRenewalReminder_DuplicateSuppressionOnDateShift is the regression test
// for the duplicate-on-date-shift bug. The renewal date moving between runs
// must NOT raise a second open alert for the same contract; the dedup key is
// keyed on the contract, not the shifting reminder date.
func TestRenewalReminder_DuplicateSuppressionOnDateShift(t *testing.T) {
	reference := time.Date(2026, time.March, 7, 9, 0, 0, 0, time.UTC)
	contract := testRenewalContract("Date shifting contract", 30, 25)
	// Pin an explicit renewal date inside the look-ahead window for run one.
	firstRenewal := normalizeMonitorDate(reference.AddDate(0, 0, 3))
	contract.RenewalDate = &firstRenewal

	store := newDedupAlertStore()
	publisher := &capturingPublisher{}

	run := func(c model.Contract) {
		reminder := newTestRenewalReminder(reference,
			func(context.Context) ([]model.Contract, error) { return []model.Contract{c}, nil },
			store.create,
			publisher,
		)
		if err := reminder.RunOnce(context.Background()); err != nil {
			t.Fatalf("RunOnce() error = %v", err)
		}
	}

	run(contract)

	// Shift the renewal date (and expiry) earlier, as a contract amendment
	// would, then run again. Pre-fix this produced a second alert.
	shiftedRenewal := normalizeMonitorDate(reference.AddDate(0, 0, 1))
	contract.RenewalDate = &shiftedRenewal
	shiftedExpiry := contract.ExpiryDate.AddDate(0, 0, -5)
	contract.ExpiryDate = &shiftedExpiry
	run(contract)

	if got := store.insertedCount(); got != 1 {
		t.Fatalf("inserted alerts after date shift = %d, want 1 (duplicate must be suppressed)", got)
	}
	if got := publisher.count(); got != 1 {
		t.Fatalf("published events after date shift = %d, want 1", got)
	}

	// After the open alert is resolved/dismissed it leaves the partial unique
	// index, so a fresh renewal alert may legitimately be raised again.
	store.resolve("renewal:" + contract.ID.String())
	run(contract)
	if got := store.insertedCount(); got != 2 {
		t.Fatalf("inserted alerts after resolve+rerun = %d, want 2", got)
	}
}

// TestRenewalReminder_DedupKeyIsContractScoped locks the dedup key shape so the
// fix can't silently regress back to a date-scoped key.
func TestRenewalReminder_DedupKeyIsContractScoped(t *testing.T) {
	reference := time.Date(2026, time.March, 7, 9, 0, 0, 0, time.UTC)
	contract := testRenewalContract("Key shape", 30, 25)

	alertA := buildRenewalAlert(&contract, normalizeMonitorDate(reference.AddDate(0, 0, 3)), reference)
	alertB := buildRenewalAlert(&contract, normalizeMonitorDate(reference.AddDate(0, 0, 1)), reference)

	if alertA.DedupKey == nil || alertB.DedupKey == nil {
		t.Fatal("expected dedup keys to be set")
	}
	want := "renewal:" + contract.ID.String()
	if *alertA.DedupKey != want {
		t.Fatalf("dedup key = %q, want %q", *alertA.DedupKey, want)
	}
	if *alertA.DedupKey != *alertB.DedupKey {
		t.Fatalf("dedup keys differ across reminder dates: %q vs %q (must be contract-scoped)", *alertA.DedupKey, *alertB.DedupKey)
	}
}

// TestRenewalReminder_AlertCreateFailureTolerated verifies that a failure
// creating one contract's alert is reported but does not abort processing of
// the remaining due contracts (errors are joined, not fatal).
func TestRenewalReminder_AlertCreateFailureTolerated(t *testing.T) {
	reference := time.Date(2026, time.March, 7, 9, 0, 0, 0, time.UTC)
	failing := testRenewalContract("Failing contract", 30, 25)
	healthy := testRenewalContract("Healthy contract", 30, 25)

	store := newDedupAlertStore()
	publisher := &capturingPublisher{}
	store.failNext = true // first create() call fails, subsequent succeed

	reminder := newTestRenewalReminder(reference,
		func(context.Context) ([]model.Contract, error) {
			return []model.Contract{failing, healthy}, nil
		},
		store.create,
		publisher,
	)

	err := reminder.RunOnce(context.Background())
	if err == nil {
		t.Fatal("expected RunOnce to return a joined error for the failed contract")
	}
	if !strings.Contains(err.Error(), failing.ID.String()) {
		t.Fatalf("error %q does not reference failing contract %s", err.Error(), failing.ID)
	}
	// The healthy contract must still have produced its alert + event.
	if got := store.insertedCount(); got != 1 {
		t.Fatalf("inserted alerts = %d, want 1 (healthy contract still processed)", got)
	}
	if got := publisher.count(); got != 1 {
		t.Fatalf("published events = %d, want 1", got)
	}
}

// TestRenewalReminder_ListErrorPropagates verifies a listing error aborts the
// run and is returned unchanged.
func TestRenewalReminder_ListErrorPropagates(t *testing.T) {
	reference := time.Date(2026, time.March, 7, 9, 0, 0, 0, time.UTC)
	sentinel := errors.New("list failed")
	store := newDedupAlertStore()
	publisher := &capturingPublisher{}

	reminder := newTestRenewalReminder(reference,
		func(context.Context) ([]model.Contract, error) { return nil, sentinel },
		store.create,
		publisher,
	)

	err := reminder.RunOnce(context.Background())
	if !errors.Is(err, sentinel) {
		t.Fatalf("RunOnce() error = %v, want %v", err, sentinel)
	}
	if store.insertedCount() != 0 || publisher.count() != 0 {
		t.Fatalf("no alerts/events expected when listing fails; got inserted=%d events=%d", store.insertedCount(), publisher.count())
	}
}

// TestRenewalReminder_NoEventWhenDedupSkips verifies that when the dedup-aware
// store reports the alert already exists (created=false), no duplicate
// alert_created event is published.
func TestRenewalReminder_NoEventWhenDedupSkips(t *testing.T) {
	reference := time.Date(2026, time.March, 7, 9, 0, 0, 0, time.UTC)
	contract := testRenewalContract("Existing alert", 30, 25)

	store := newDedupAlertStore()
	// Pre-seed an open alert for this contract's dedup key.
	store.open["renewal:"+contract.ID.String()] = uuid.New()
	publisher := &capturingPublisher{}

	reminder := newTestRenewalReminder(reference,
		func(context.Context) ([]model.Contract, error) { return []model.Contract{contract}, nil },
		store.create,
		publisher,
	)

	if err := reminder.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if got := store.insertedCount(); got != 0 {
		t.Fatalf("inserted alerts = %d, want 0 (dedup hit)", got)
	}
	if got := publisher.count(); got != 0 {
		t.Fatalf("published events = %d, want 0 (no event on dedup skip)", got)
	}
}
