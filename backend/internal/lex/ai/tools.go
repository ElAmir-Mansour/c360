package ai

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
)

// Grounding domains. These are the resolution-rate report's category keys, so a
// domain the model names maps 1:1 onto real data with no translation table.
const (
	domainContracts  = "contracts"
	domainLitigation = "litigation"
	domainAdvisory   = "advisory"
	domainRequests   = "requests"
)

// legalDomains is the fixed grounding order (matches ResolutionRateService).
var legalDomains = []string{domainContracts, domainLitigation, domainAdvisory, domainRequests}

// DashboardReader is the contract-portfolio read surface the tools need.
// *service.DashboardService satisfies it unchanged.
type DashboardReader interface {
	GetDashboard(ctx context.Context, tenantID uuid.UUID) (*model.LexDashboard, error)
}

// ResolutionRateReader is the cross-domain resolution-rate read surface.
// *service.ResolutionRateService satisfies it unchanged.
type ResolutionRateReader interface {
	ResolutionRates(ctx context.Context, tenantID uuid.UUID) (*model.ResolutionRateReport, error)
}

// WorkforceReader is the named per-person workload read surface.
// *service.WorkforceService satisfies it unchanged.
type WorkforceReader interface {
	Report(ctx context.Context, tenantID, callerID uuid.UUID, query service.WorkforceReportQuery) (*model.WorkforceReport, error)
}

// Tools holds the grounding surface the model may call. Every tool returns a
// TYPED summary computed from the same tenant-scoped services the REST API
// uses — there is no free-form query path, no SQL, and no table access. Each
// result is masked by the caller's Grants, so the assistant can only ever
// restate data its caller could already read.
type Tools struct {
	dashboard DashboardReader
	rates     ResolutionRateReader
	workforce WorkforceReader
	now       func() time.Time
}

// NewTools wires the grounding tools. Any reader may be nil: the corresponding
// slice of the summary is then reported as unavailable rather than fabricated.
func NewTools(dashboard DashboardReader, rates ResolutionRateReader, workforce WorkforceReader, now func() time.Time) *Tools {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Tools{dashboard: dashboard, rates: rates, workforce: workforce, now: now}
}

// ---------------------------------------------------------------------------
// Grounding result shapes (the JSON the model consumes — real, computed values)
// ---------------------------------------------------------------------------

// PortfolioSummary is the legal-affairs posture the assistant grounds on: the
// per-domain resolution rates plus the contract-portfolio KPIs.
type PortfolioSummary struct {
	GeneratedAt time.Time      `json:"generated_at"`
	Domains     []DomainRate   `json:"domains"`
	Contracts   *ContractsKPIs `json:"contracts,omitempty"`
	// MaskedDomains names the domains withheld because the caller lacks the
	// domain's view permission. Surfacing them (rather than silently omitting)
	// lets the model say "I can't see litigation" instead of implying zero.
	MaskedDomains []string `json:"masked_domains,omitempty"`
}

// DomainRate is one legal domain's open/resolved posture.
type DomainRate struct {
	Domain            string `json:"domain"`
	Total             int    `json:"total"`
	Resolved          int    `json:"resolved"`
	Open              int    `json:"open"`
	ResolutionRatePct int    `json:"resolution_rate_pct"`
}

// ContractsKPIs is the contract-portfolio slice of the dashboard model.
type ContractsKPIs struct {
	ActiveContracts   int     `json:"active_contracts"`
	ExpiringIn30Days  int     `json:"expiring_in_30_days"`
	ExpiringIn7Days   int     `json:"expiring_in_7_days"`
	HighRiskContracts int     `json:"high_risk_contracts"`
	PendingReview     int     `json:"pending_review"`
	OpenAlerts        int     `json:"open_compliance_alerts"`
	ComplianceScore   float64 `json:"compliance_score"`
}

// DomainDetail is one domain drilled into: its rate plus whatever named detail
// the domain owns (contracts carry expiry and risk lists).
type DomainDetail struct {
	GeneratedAt time.Time      `json:"generated_at"`
	Domain      string         `json:"domain"`
	Rate        DomainRate     `json:"rate"`
	Contracts   *ContractsKPIs `json:"contracts,omitempty"`
	// Expiring lists the soonest-expiring contracts (contracts domain only).
	Expiring []ContractExpiry `json:"expiring,omitempty"`
}

// ContractExpiry is one contract approaching its expiry date.
type ContractExpiry struct {
	Title           string    `json:"title"`
	Status          string    `json:"status"`
	Counterparty    string    `json:"counterparty,omitempty"`
	ExpiryDate      time.Time `json:"expiry_date"`
	DaysUntilExpiry int       `json:"days_until_expiry"`
}

// TeamWorkloadSummary is the named per-person workload slice. It carries the
// workforce contract's honesty signals through unchanged: Degraded means some
// metric could not be computed (e.g. no tenant working calendar), and a nil
// metric means unavailable — never a fabricated zero.
type TeamWorkloadSummary struct {
	GeneratedAt time.Time            `json:"generated_at"`
	PeriodFrom  string               `json:"period_from,omitempty"`
	PeriodTo    string               `json:"period_to,omitempty"`
	MemberCount int                  `json:"member_count"`
	Members     []TeamWorkloadMember `json:"members"`
	Degraded    bool                 `json:"degraded"`
	// ExcludedDomains names domains the workforce report could not include for
	// this caller (permission-masked or query error).
	ExcludedDomains []string `json:"excluded_domains,omitempty"`
}

// TeamWorkloadMember is one named team member's load.
type TeamWorkloadMember struct {
	DisplayName    string   `json:"display_name"`
	ActiveWorkload *float64 `json:"active_workload,omitempty"`
	LoadIndexPct   *float64 `json:"load_index_pct,omitempty"`
	OverdueCount   *float64 `json:"overdue_count,omitempty"`
}

// maxWorkloadMembers bounds the workload payload handed to the model. A legal
// department larger than this is summarised by the busiest members, which is
// what the "who is overloaded" question actually needs.
const maxWorkloadMembers = 25

// maxExpiringContracts bounds the expiry list handed to the model.
const maxExpiringContracts = 10

// ---------------------------------------------------------------------------
// PortfolioSummary
// ---------------------------------------------------------------------------

// PortfolioSummary reports the tenant's legal-affairs posture: per-domain
// resolution rates and, when the caller may view contracts, the contract
// portfolio KPIs. Domains the caller cannot view are withheld and named in
// MaskedDomains.
func (t *Tools) PortfolioSummary(ctx context.Context, tenantID uuid.UUID, grants Grants) (*PortfolioSummary, error) {
	out := &PortfolioSummary{GeneratedAt: t.now()}

	if t.rates != nil {
		report, err := t.rates.ResolutionRates(ctx, tenantID)
		if err != nil {
			return nil, fmt.Errorf("lex ai: PortfolioSummary: resolution rates: %w", err)
		}
		for _, category := range report.Categories {
			if !domainVisible(category.Key, grants) {
				out.MaskedDomains = append(out.MaskedDomains, category.Key)
				continue
			}
			out.Domains = append(out.Domains, domainRate(category))
		}
	}

	if grants.Contracts && t.dashboard != nil {
		dashboard, err := t.dashboard.GetDashboard(ctx, tenantID)
		if err != nil {
			return nil, fmt.Errorf("lex ai: PortfolioSummary: dashboard: %w", err)
		}
		out.Contracts = contractsKPIs(dashboard)
	}

	return out, nil
}

// ---------------------------------------------------------------------------
// DomainDetail
// ---------------------------------------------------------------------------

// DomainDetail drills into one legal domain. It fails with a plain error (fed
// back to the model as a tool error, not a 500) when the domain is unknown or
// the caller may not view it — the model then says so rather than guessing.
func (t *Tools) DomainDetail(ctx context.Context, tenantID uuid.UUID, grants Grants, domain string) (*DomainDetail, error) {
	domain = strings.ToLower(strings.TrimSpace(domain))
	if !knownDomain(domain) {
		return nil, fmt.Errorf("lex ai: DomainDetail: unknown domain %q (expected one of %s)", domain, strings.Join(legalDomains, ", "))
	}
	if !domainVisible(domain, grants) {
		return nil, fmt.Errorf("lex ai: DomainDetail: the caller is not permitted to view %s", domain)
	}
	if t.rates == nil {
		return nil, fmt.Errorf("lex ai: DomainDetail: resolution rates are unavailable")
	}
	report, err := t.rates.ResolutionRates(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("lex ai: DomainDetail: resolution rates: %w", err)
	}
	out := &DomainDetail{GeneratedAt: t.now(), Domain: domain, Rate: DomainRate{Domain: domain}}
	for _, category := range report.Categories {
		if category.Key == domain {
			out.Rate = domainRate(category)
			break
		}
	}

	if domain == domainContracts && t.dashboard != nil {
		dashboard, derr := t.dashboard.GetDashboard(ctx, tenantID)
		if derr != nil {
			return nil, fmt.Errorf("lex ai: DomainDetail: dashboard: %w", derr)
		}
		out.Contracts = contractsKPIs(dashboard)
		out.Expiring = expiringContracts(dashboard, maxExpiringContracts)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// TeamWorkload
// ---------------------------------------------------------------------------

// TeamWorkload reports named per-person workload for the caller's scope. It
// requires the dedicated lex:workforce:read grant — named workload is more
// sensitive than aggregate reporting and is never implied by lex:read — and it
// runs the workforce service with the caller's own id so its ABAC scope
// resolution applies exactly as it does on GET /lex/reports/workforce.
func (t *Tools) TeamWorkload(ctx context.Context, tenantID, callerID uuid.UUID, grants Grants) (*TeamWorkloadSummary, error) {
	if !grants.Workforce {
		return nil, fmt.Errorf("lex ai: TeamWorkload: the caller is not permitted to view named workload")
	}
	if t.workforce == nil {
		return nil, fmt.Errorf("lex ai: TeamWorkload: workforce reporting is unavailable")
	}
	query := service.WorkforceReportQuery{
		HasWorkforceAccess: true,
		HasExecutiveRole:   grants.Contracts && grants.Cases && grants.Consultations && grants.Requests,
		ForbiddenDomains: map[string]bool{
			"contracts":        !grants.Contracts,
			"contract_intakes": !grants.Contracts,
			"consultations":    !grants.Consultations,
			"cases":            !grants.Cases,
			"requests":         !grants.Requests,
		},
		Limit: maxWorkloadMembers,
	}
	report, err := t.workforce.Report(ctx, tenantID, callerID, query)
	if err != nil {
		return nil, fmt.Errorf("lex ai: TeamWorkload: %w", err)
	}
	return workloadSummary(report, t.now(), maxWorkloadMembers), nil
}

// ---------------------------------------------------------------------------
// helpers (pure, real computations)
// ---------------------------------------------------------------------------

func knownDomain(domain string) bool {
	for _, known := range legalDomains {
		if known == domain {
			return true
		}
	}
	return false
}

// domainVisible maps a grounding domain onto the read permission that already
// gates the equivalent REST surface.
func domainVisible(domain string, grants Grants) bool {
	switch domain {
	case domainContracts:
		return grants.Contracts
	case domainLitigation:
		return grants.Cases
	case domainAdvisory:
		return grants.Consultations
	case domainRequests:
		return grants.Requests
	default:
		return false
	}
}

func domainRate(category model.ResolutionRateCategory) DomainRate {
	open := category.Total - category.Resolved
	if open < 0 {
		open = 0
	}
	return DomainRate{
		Domain:            category.Key,
		Total:             category.Total,
		Resolved:          category.Resolved,
		Open:              open,
		ResolutionRatePct: category.Rate,
	}
}

func contractsKPIs(dashboard *model.LexDashboard) *ContractsKPIs {
	if dashboard == nil {
		return nil
	}
	return &ContractsKPIs{
		ActiveContracts:   dashboard.KPIs.ActiveContracts,
		ExpiringIn30Days:  dashboard.KPIs.ExpiringIn30Days,
		ExpiringIn7Days:   dashboard.KPIs.ExpiringIn7Days,
		HighRiskContracts: dashboard.KPIs.HighRiskContracts,
		PendingReview:     dashboard.KPIs.PendingReview,
		OpenAlerts:        dashboard.KPIs.OpenAlerts,
		ComplianceScore:   dashboard.KPIs.ComplianceScore,
	}
}

func expiringContracts(dashboard *model.LexDashboard, limit int) []ContractExpiry {
	if dashboard == nil || len(dashboard.ExpiringContracts) == 0 {
		return nil
	}
	items := dashboard.ExpiringContracts
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	out := make([]ContractExpiry, 0, len(items))
	for _, item := range items {
		out = append(out, ContractExpiry{
			Title:           item.Title,
			Status:          string(item.Status),
			Counterparty:    item.PartyBName,
			ExpiryDate:      item.ExpiryDate,
			DaysUntilExpiry: item.DaysUntilExpiry,
		})
	}
	return out
}

// workloadSummary projects the 13KB workforce contract down to the few fields
// the assistant can honestly reason about, preserving the availability signal
// (a nil metric means "not computable", never zero) and reporting the busiest
// members first so a truncated list is still the useful one.
func workloadSummary(report *model.WorkforceReport, generatedAt time.Time, limit int) *TeamWorkloadSummary {
	out := &TeamWorkloadSummary{GeneratedAt: generatedAt}
	if report == nil {
		return out
	}
	out.PeriodFrom = report.Period.From
	out.PeriodTo = report.Period.To
	out.MemberCount = len(report.Team)
	out.Degraded = report.Degraded
	for _, domainErr := range report.Errors {
		out.ExcludedDomains = append(out.ExcludedDomains, domainErr.Domain)
	}

	members := make([]TeamWorkloadMember, 0, len(report.Team))
	for _, member := range report.Team {
		members = append(members, TeamWorkloadMember{
			DisplayName:    member.DisplayName,
			ActiveWorkload: metricValue(member.Metrics.ActiveWorkload),
			LoadIndexPct:   metricValue(member.Metrics.LoadIndexPct),
			OverdueCount:   metricValue(member.Metrics.OverdueCount),
		})
	}
	sort.SliceStable(members, func(i, j int) bool {
		return workloadOrder(members[i]) > workloadOrder(members[j])
	})
	if limit > 0 && len(members) > limit {
		members = members[:limit]
	}
	out.Members = members
	return out
}

// metricValue unwraps a workforce MetricValue, preserving unavailability as nil
// rather than collapsing it to 0.
func metricValue(m model.MetricValue) *float64 {
	if !m.Available || m.Value == nil {
		return nil
	}
	value := *m.Value
	return &value
}

// workloadOrder sorts by active workload, treating an unavailable metric as -1
// so members with no measurable load sink below members with a real zero.
func workloadOrder(m TeamWorkloadMember) float64 {
	if m.ActiveWorkload == nil {
		return -1
	}
	return *m.ActiveWorkload
}
