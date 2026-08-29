package ai

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
)

var (
	testTenantID = uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	testUserID   = uuid.MustParse("bbbbbbbb-0000-0000-0000-000000000002")
	testNow      = time.Date(2026, 7, 31, 9, 0, 0, 0, time.UTC)
)

func fixedNow() time.Time { return testNow }

// allGrants is the Legal Director's grant set: every legal domain plus named
// workforce reporting.
func allGrants() Grants {
	return Grants{Contracts: true, Cases: true, Consultations: true, Requests: true, Workforce: true}
}

type fakeRates struct {
	report *model.ResolutionRateReport
	err    error
	calls  int
}

func (f *fakeRates) ResolutionRates(_ context.Context, _ uuid.UUID) (*model.ResolutionRateReport, error) {
	f.calls++
	return f.report, f.err
}

type fakeDashboard struct {
	dashboard *model.LexDashboard
	err       error
	calls     int
}

func (f *fakeDashboard) GetDashboard(_ context.Context, _ uuid.UUID) (*model.LexDashboard, error) {
	f.calls++
	return f.dashboard, f.err
}

type fakeWorkforce struct {
	report *model.WorkforceReport
	err    error
	query  service.WorkforceReportQuery
	caller uuid.UUID
	calls  int
}

func (f *fakeWorkforce) Report(_ context.Context, _, callerID uuid.UUID, query service.WorkforceReportQuery) (*model.WorkforceReport, error) {
	f.calls++
	f.caller = callerID
	f.query = query
	return f.report, f.err
}

func sampleRates() *model.ResolutionRateReport {
	return &model.ResolutionRateReport{
		CalculatedAt: testNow,
		Categories: []model.ResolutionRateCategory{
			{Key: "contracts", Total: 45, Resolved: 36, Rate: 80},
			{Key: "litigation", Total: 33, Resolved: 11, Rate: 33},
			{Key: "advisory", Total: 56, Resolved: 42, Rate: 75},
			{Key: "requests", Total: 120, Resolved: 108, Rate: 90},
		},
	}
}

func sampleDashboard() *model.LexDashboard {
	return &model.LexDashboard{
		KPIs: model.LexKPIs{
			ActiveContracts:   45,
			ExpiringIn30Days:  7,
			ExpiringIn7Days:   2,
			HighRiskContracts: 3,
			PendingReview:     9,
			OpenAlerts:        4,
			ComplianceScore:   99,
		},
		ExpiringContracts: []model.ExpiringContractSummary{
			{Title: "Riyadh HQ Lease", Status: model.ContractStatus("active"), PartyBName: "Al Othaim Malls", ExpiryDate: testNow.AddDate(0, 0, 5), DaysUntilExpiry: 5},
			{Title: "Fleet Maintenance", Status: model.ContractStatus("active"), PartyBName: "Petromin", ExpiryDate: testNow.AddDate(0, 0, 21), DaysUntilExpiry: 21},
		},
	}
}

// The grounding summary must mask every domain the caller cannot view, and must
// NAME the masked domains rather than silently dropping them — the model has to
// be able to say "I can't see litigation" instead of implying zero.
func TestPortfolioSummaryMasksDomainsByGrant(t *testing.T) {
	cases := []struct {
		name          string
		grants        Grants
		wantVisible   []string
		wantMasked    []string
		wantContracts bool
	}{
		{
			name:          "legal director sees everything",
			grants:        allGrants(),
			wantVisible:   []string{"contracts", "litigation", "advisory", "requests"},
			wantMasked:    nil,
			wantContracts: true,
		},
		{
			name:          "no contract grant masks contracts and withholds contract KPIs",
			grants:        Grants{Cases: true, Consultations: true, Requests: true},
			wantVisible:   []string{"litigation", "advisory", "requests"},
			wantMasked:    []string{"contracts"},
			wantContracts: false,
		},
		{
			name:          "requests-only caller sees one domain",
			grants:        Grants{Requests: true},
			wantVisible:   []string{"requests"},
			wantMasked:    []string{"contracts", "litigation", "advisory"},
			wantContracts: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dashboard := &fakeDashboard{dashboard: sampleDashboard()}
			tools := NewTools(dashboard, &fakeRates{report: sampleRates()}, nil, fixedNow)

			got, err := tools.PortfolioSummary(context.Background(), testTenantID, tc.grants)
			if err != nil {
				t.Fatalf("PortfolioSummary: %v", err)
			}
			visible := make([]string, 0, len(got.Domains))
			for _, d := range got.Domains {
				visible = append(visible, d.Domain)
			}
			if strings.Join(visible, ",") != strings.Join(tc.wantVisible, ",") {
				t.Errorf("visible domains = %v, want %v", visible, tc.wantVisible)
			}
			if strings.Join(got.MaskedDomains, ",") != strings.Join(tc.wantMasked, ",") {
				t.Errorf("masked domains = %v, want %v", got.MaskedDomains, tc.wantMasked)
			}
			if (got.Contracts != nil) != tc.wantContracts {
				t.Errorf("contracts KPIs present = %v, want %v", got.Contracts != nil, tc.wantContracts)
			}
			// The dashboard must not even be READ when the caller cannot view
			// contracts — masking is enforced before the query, not after.
			if !tc.wantContracts && dashboard.calls != 0 {
				t.Errorf("dashboard read %d time(s) for a caller without lex:contract:view, want 0", dashboard.calls)
			}
			if got.GeneratedAt != testNow {
				t.Errorf("GeneratedAt = %v, want %v", got.GeneratedAt, testNow)
			}
		})
	}
}

// Open is derived, not read: total - resolved, floored at zero so a repository
// skew can never produce a negative backlog in the model's context.
func TestPortfolioSummaryDerivesOpenCount(t *testing.T) {
	rates := &model.ResolutionRateReport{Categories: []model.ResolutionRateCategory{
		{Key: "contracts", Total: 45, Resolved: 36, Rate: 80},
		{Key: "litigation", Total: 5, Resolved: 9, Rate: 100}, // skewed: resolved > total
	}}
	tools := NewTools(nil, &fakeRates{report: rates}, nil, fixedNow)

	got, err := tools.PortfolioSummary(context.Background(), testTenantID, allGrants())
	if err != nil {
		t.Fatalf("PortfolioSummary: %v", err)
	}
	if got.Domains[0].Open != 9 {
		t.Errorf("contracts open = %d, want 9", got.Domains[0].Open)
	}
	if got.Domains[1].Open != 0 {
		t.Errorf("skewed litigation open = %d, want 0 (floored)", got.Domains[1].Open)
	}
}

func TestDomainDetail(t *testing.T) {
	cases := []struct {
		name         string
		domain       string
		grants       Grants
		wantErr      string
		wantRate     int
		wantExpiring int
	}{
		{name: "contracts returns KPIs and expiries", domain: "contracts", grants: allGrants(), wantRate: 80, wantExpiring: 2},
		{name: "litigation returns rate only", domain: "litigation", grants: allGrants(), wantRate: 33},
		{name: "case-insensitive and trimmed", domain: "  Advisory ", grants: allGrants(), wantRate: 75},
		{name: "unknown domain is rejected", domain: "obligations", grants: allGrants(), wantErr: "unknown domain"},
		{name: "ungranted domain is rejected", domain: "contracts", grants: Grants{Requests: true}, wantErr: "not permitted"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tools := NewTools(&fakeDashboard{dashboard: sampleDashboard()}, &fakeRates{report: sampleRates()}, nil, fixedNow)

			got, err := tools.DomainDetail(context.Background(), testTenantID, tc.grants, tc.domain)
			if tc.wantErr != "" {
				if err == nil {
					t.Fatalf("DomainDetail(%q) = nil error, want error containing %q", tc.domain, tc.wantErr)
				}
				if !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("DomainDetail(%q) error = %v, want it to contain %q", tc.domain, err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("DomainDetail(%q): %v", tc.domain, err)
			}
			if got.Rate.ResolutionRatePct != tc.wantRate {
				t.Errorf("rate = %d, want %d", got.Rate.ResolutionRatePct, tc.wantRate)
			}
			if len(got.Expiring) != tc.wantExpiring {
				t.Errorf("expiring = %d, want %d", len(got.Expiring), tc.wantExpiring)
			}
			if tc.wantExpiring > 0 {
				first := got.Expiring[0]
				if first.Title != "Riyadh HQ Lease" || first.DaysUntilExpiry != 5 || first.Counterparty != "Al Othaim Malls" {
					t.Errorf("first expiry = %+v, want the Riyadh HQ Lease projection", first)
				}
			}
		})
	}
}

// Named per-person workload requires the dedicated lex:workforce:read grant. A
// Legal Director without it must be refused rather than quietly handed an
// aggregate — the whole point of that permission is that names are sensitive.
func TestTeamWorkloadRequiresWorkforceGrant(t *testing.T) {
	workforce := &fakeWorkforce{report: &model.WorkforceReport{}}
	tools := NewTools(nil, nil, workforce, fixedNow)

	_, err := tools.TeamWorkload(context.Background(), testTenantID, testUserID, Grants{Contracts: true, Cases: true})
	if err == nil || !strings.Contains(err.Error(), "not permitted") {
		t.Fatalf("TeamWorkload without the workforce grant = %v, want a not-permitted error", err)
	}
	if workforce.calls != 0 {
		t.Errorf("workforce service called %d time(s) without the grant, want 0", workforce.calls)
	}
}

// The workforce query must carry the caller's own id and their per-domain
// masking, so the assistant path resolves exactly the same scope the REST
// endpoint would for that user.
func TestTeamWorkloadForwardsCallerScopeAndMasking(t *testing.T) {
	workforce := &fakeWorkforce{report: &model.WorkforceReport{}}
	tools := NewTools(nil, nil, workforce, fixedNow)

	grants := Grants{Contracts: false, Cases: true, Consultations: true, Requests: true, Workforce: true}
	if _, err := tools.TeamWorkload(context.Background(), testTenantID, testUserID, grants); err != nil {
		t.Fatalf("TeamWorkload: %v", err)
	}
	if workforce.caller != testUserID {
		t.Errorf("caller id = %s, want %s", workforce.caller, testUserID)
	}
	if !workforce.query.HasWorkforceAccess {
		t.Error("HasWorkforceAccess = false, want true")
	}
	if workforce.query.HasExecutiveRole {
		t.Error("HasExecutiveRole = true for a caller missing contracts, want false")
	}
	for domain, wantForbidden := range map[string]bool{
		"contracts": true, "contract_intakes": true, "cases": false, "consultations": false, "requests": false,
	} {
		if got := workforce.query.ForbiddenDomains[domain]; got != wantForbidden {
			t.Errorf("ForbiddenDomains[%q] = %v, want %v", domain, got, wantForbidden)
		}
	}
}

// The workforce contract's honesty signals must survive projection: an
// unavailable metric stays nil (never a fabricated 0), degraded is carried
// through, and the busiest members sort first so a truncated list is useful.
func TestTeamWorkloadSummaryPreservesAvailabilityAndOrders(t *testing.T) {
	available := func(v float64) model.MetricValue { return model.MetricValue{Value: &v, Available: true} }
	unavailable := model.MetricValue{Available: false, Reason: "no_calendar"}

	report := &model.WorkforceReport{
		Period:   model.PeriodEnvelope{From: "2026-07-01", To: "2026-07-31"},
		Degraded: true,
		Errors:   []model.DomainError{{Domain: "contracts", Kind: model.DomainErrorForbidden}},
		Team: []model.TeamMember{
			{DisplayName: "Sara", Metrics: model.TeamMemberMetrics{ActiveWorkload: available(4), LoadIndexPct: unavailable}},
			{DisplayName: "Unmeasured", Metrics: model.TeamMemberMetrics{ActiveWorkload: unavailable}},
			{DisplayName: "Khalid", Metrics: model.TeamMemberMetrics{ActiveWorkload: available(11), OverdueCount: available(2)}},
			{DisplayName: "Idle", Metrics: model.TeamMemberMetrics{ActiveWorkload: available(0)}},
		},
	}
	got := workloadSummary(report, testNow, 25)

	if got.MemberCount != 4 {
		t.Errorf("MemberCount = %d, want 4", got.MemberCount)
	}
	if !got.Degraded {
		t.Error("Degraded = false, want true")
	}
	if len(got.ExcludedDomains) != 1 || got.ExcludedDomains[0] != "contracts" {
		t.Errorf("ExcludedDomains = %v, want [contracts]", got.ExcludedDomains)
	}
	wantOrder := []string{"Khalid", "Sara", "Idle", "Unmeasured"}
	for i, want := range wantOrder {
		if got.Members[i].DisplayName != want {
			t.Fatalf("member[%d] = %q, want %q (order = %v)", i, got.Members[i].DisplayName, want, memberNames(got.Members))
		}
	}
	if got.Members[1].LoadIndexPct != nil {
		t.Errorf("Sara LoadIndexPct = %v, want nil (unavailable must not become 0)", *got.Members[1].LoadIndexPct)
	}
	if got.Members[2].ActiveWorkload == nil || *got.Members[2].ActiveWorkload != 0 {
		t.Errorf("Idle ActiveWorkload = %v, want a real 0 (available)", got.Members[2].ActiveWorkload)
	}
	if got.Members[3].ActiveWorkload != nil {
		t.Errorf("Unmeasured ActiveWorkload = %v, want nil", *got.Members[3].ActiveWorkload)
	}
}

func TestTeamWorkloadSummaryTruncatesToBusiest(t *testing.T) {
	value := func(v float64) model.MetricValue { return model.MetricValue{Value: &v, Available: true} }
	team := make([]model.TeamMember, 0, 5)
	for i, load := range []float64{1, 9, 3, 7, 5} {
		team = append(team, model.TeamMember{
			DisplayName: string(rune('A' + i)),
			Metrics:     model.TeamMemberMetrics{ActiveWorkload: value(load)},
		})
	}
	got := workloadSummary(&model.WorkforceReport{Team: team}, testNow, 2)

	if got.MemberCount != 5 {
		t.Errorf("MemberCount = %d, want 5 (the count is the full team, not the truncated list)", got.MemberCount)
	}
	if len(got.Members) != 2 {
		t.Fatalf("members returned = %d, want 2", len(got.Members))
	}
	if got.Members[0].DisplayName != "B" || got.Members[1].DisplayName != "D" {
		t.Errorf("truncated members = %v, want the two busiest [B D]", memberNames(got.Members))
	}
}

// A reader failure must surface as an error, never as an empty-but-plausible
// summary the model would then report as "you have no contracts".
func TestGroundingReaderErrorsPropagate(t *testing.T) {
	boom := errors.New("db down")

	tools := NewTools(&fakeDashboard{dashboard: sampleDashboard()}, &fakeRates{err: boom}, nil, fixedNow)
	if _, err := tools.PortfolioSummary(context.Background(), testTenantID, allGrants()); !errors.Is(err, boom) {
		t.Errorf("PortfolioSummary with a failing rates reader = %v, want it to wrap %v", err, boom)
	}

	tools = NewTools(&fakeDashboard{err: boom}, &fakeRates{report: sampleRates()}, nil, fixedNow)
	if _, err := tools.PortfolioSummary(context.Background(), testTenantID, allGrants()); !errors.Is(err, boom) {
		t.Errorf("PortfolioSummary with a failing dashboard reader = %v, want it to wrap %v", err, boom)
	}

	tools = NewTools(nil, nil, &fakeWorkforce{err: boom}, fixedNow)
	if _, err := tools.TeamWorkload(context.Background(), testTenantID, testUserID, allGrants()); !errors.Is(err, boom) {
		t.Errorf("TeamWorkload with a failing workforce reader = %v, want it to wrap %v", err, boom)
	}
}

func memberNames(members []TeamWorkloadMember) []string {
	out := make([]string, 0, len(members))
	for _, m := range members {
		out = append(out, m.DisplayName)
	}
	return out
}
