package service

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// Contract portfolio insight kinds (#13 PORTFOLIO INSIGHTS). Each kind maps to
// one family of ranked, compute-on-read insight cards surfaced on the contract
// list workspace.
const (
	ContractInsightKindMissingClause = "missing_mandatory_clause"
	ContractInsightKindRenewalOptOut = "renewal_opt_out_closing"
	ContractInsightKindValueOutlier  = "value_outlier"
	ContractInsightKindConcentration = "counterparty_concentration"
	ContractInsightKindStaleDraft    = "stale_draft"
)

// Compute caps. Insights are a synchronous, live aggregate (no cached score
// store), so every source scan is bounded: the contract list repo clamps
// per_page at 200 and the playbook portfolio service caps its own scan at
// PortfolioMaxScan (200). The report flags `truncated` when the tenant holds
// more rows than a bounded scan covered.
const (
	// insightsMaxScan bounds each contract list scan (repo clamps at 200 anyway).
	insightsMaxScan = 200
	// insightsMaxContractIDs caps the contract ids attached to one insight card.
	insightsMaxContractIDs = 25
	// insightsComplianceScanPerPage bounds the playbook-compliance rows pulled for
	// the missing-mandatory-clause card (the playbook service additionally caps
	// its own live scan at PortfolioMaxScan).
	insightsComplianceScanPerPage = 100
	// insightsOutlierMinSample is the minimum number of valued contracts a
	// (type, currency) cohort needs before a p95 outlier check is meaningful.
	insightsOutlierMinSample = 8
	// insightsOutlierMaxCards caps how many per-cohort outlier cards are emitted.
	insightsOutlierMaxCards = 3
	// insightsConcentrationMinShare is the top-counterparty share of total active
	// value at which a concentration card fires.
	insightsConcentrationMinShare = 0.25
	// insightsConcentrationMinContracts is the minimum valued-contract count in
	// the dominant currency cohort for concentration to be meaningful.
	insightsConcentrationMinContracts = 3
	// insightsStaleDraftEscalationDays escalates the stale-draft card severity.
	insightsStaleDraftEscalationDays = 90
)

// ContractInsight is one ranked, bilingual insight card. Severity reuses the
// lex RiskLevel scale so the frontend badge primitives apply unchanged. Metric
// carries the raw numbers behind the card so the frontend can re-format them
// with KSA locale rules (Arabic-Indic digits, SAR) instead of parsing text.
type ContractInsight struct {
	ID          string          `json:"id"`
	Kind        string          `json:"kind"`
	Severity    model.RiskLevel `json:"severity"`
	TitleEN     string          `json:"title_en"`
	TitleAR     string          `json:"title_ar"`
	DetailEN    string          `json:"detail_en"`
	DetailAR    string          `json:"detail_ar"`
	ContractIDs []uuid.UUID     `json:"contract_ids"`
	Metric      map[string]any  `json:"metric"`
}

// ContractInsightsReport is the GET /contracts/insights payload.
type ContractInsightsReport struct {
	Insights       []ContractInsight `json:"insights"`
	GeneratedAt    time.Time         `json:"generated_at"`
	WindowDays     int               `json:"window_days"`
	StaleDraftDays int               `json:"stale_draft_days"`
	ScannedActive  int               `json:"scanned_active_contracts"`
	// Truncated is true when a bounded scan covered fewer rows than the tenant
	// holds; the cards are then computed over the newest slice of the portfolio.
	Truncated bool `json:"truncated"`
}

// ContractInsightsOptions carries the caller-tunable knobs; zero values apply
// the defaults (30-day opt-out window, 30-day stale-draft threshold).
type ContractInsightsOptions struct {
	WindowDays     int
	StaleDraftDays int
}

// insightContractSource is the subset of repository.ContractRepository the
// insights service reads. Declared as an interface so calculators are testable
// with fixture data and no database.
type insightContractSource interface {
	List(ctx context.Context, tenantID uuid.UUID, filters model.ContractListFilters) ([]model.Contract, int, error)
	ListRenewalWarningCandidates(ctx context.Context, tenantID uuid.UUID, horizonDays, leadDays int) ([]model.Contract, error)
}

// insightComplianceSource is the subset of PlaybookService the insights
// service reads for the missing-mandatory-clause card (WTQ-RSK-02 portfolio).
type insightComplianceSource interface {
	Portfolio(ctx context.Context, tenantID uuid.UUID, filters model.PlaybookPortfolioFilters) ([]model.PlaybookComplianceRow, int, bool, error)
}

// ContractInsightsService computes the ranked portfolio insight feed
// (#13 PORTFOLIO INSIGHTS) on read. It owns NO storage: every card derives
// from existing repositories/services under the bounded scans documented on
// the constants above.
type ContractInsightsService struct {
	contracts  insightContractSource
	compliance insightComplianceSource
	logger     zerolog.Logger
	now        func() time.Time
}

// NewContractInsightsService wires the insight feed. compliance may be nil
// (e.g. playbooks not configured); the missing-clause card is then skipped.
func NewContractInsightsService(contracts insightContractSource, compliance insightComplianceSource, logger zerolog.Logger) *ContractInsightsService {
	return &ContractInsightsService{
		contracts:  contracts,
		compliance: compliance,
		logger:     logger.With().Str("service", "lex-contract-insights").Logger(),
		now:        time.Now,
	}
}

// PortfolioInsights computes the ranked insight cards for the tenant.
//
// COST: three bounded repo scans (active slice, draft slice, renewal-window
// candidates — each date/status filtered and clamped at 200 rows) plus one
// playbook portfolio pass (itself capped at PortfolioMaxScan). The playbook
// pass is the only expensive source (live clause comparison), so its failure
// degrades the feed (card skipped, warning logged) instead of failing it.
func (s *ContractInsightsService) PortfolioInsights(ctx context.Context, tenantID uuid.UUID, opts ContractInsightsOptions) (*ContractInsightsReport, error) {
	now := s.now().UTC()
	windowDays := opts.WindowDays
	if windowDays <= 0 {
		windowDays = 30
	}
	if windowDays > 365 {
		windowDays = 365
	}
	staleDays := opts.StaleDraftDays
	if staleDays <= 0 {
		staleDays = 30
	}
	if staleDays > 365 {
		staleDays = 365
	}

	activeStatus := model.ContractStatusActive
	active, totalActive, err := s.contracts.List(ctx, tenantID, model.ContractListFilters{
		Page: 1, PerPage: insightsMaxScan, Status: &activeStatus,
	})
	if err != nil {
		return nil, internalError("list active contracts for insights", err)
	}

	draftStatus := model.ContractStatusDraft
	drafts, totalDrafts, err := s.contracts.List(ctx, tenantID, model.ContractListFilters{
		Page: 1, PerPage: insightsMaxScan, Status: &draftStatus,
		SortColumn: "c.updated_at", SortDirection: "asc",
	})
	if err != nil {
		return nil, internalError("list draft contracts for insights", err)
	}

	// leadDays=0 keeps the repo lead at each contract's own renewal_notice_days,
	// which is exactly the opt-out deadline the trap calculator re-derives.
	renewalCandidates, err := s.contracts.ListRenewalWarningCandidates(ctx, tenantID, windowDays, 0)
	if err != nil {
		return nil, internalError("list renewal candidates for insights", err)
	}

	insights := make([]ContractInsight, 0, 8)

	// (a) Contracts missing mandatory playbook clauses (data protection et al).
	if s.compliance != nil {
		rows, _, _, err := s.compliance.Portfolio(ctx, tenantID, model.PlaybookPortfolioFilters{
			Page: 1, PerPage: insightsComplianceScanPerPage, SortDirection: "asc",
		})
		if err != nil {
			s.logger.Warn().Err(err).Str("tenant_id", tenantID.String()).
				Msg("playbook compliance scan failed; skipping missing-clause insight")
		} else if card, ok := buildMissingClauseInsight(rows); ok {
			insights = append(insights, card)
		}
	}

	// (b) Auto-renew opt-out windows closing within the horizon.
	if card, ok := buildRenewalOptOutInsight(computeRenewalOptOutTraps(renewalCandidates, now, windowDays), windowDays); ok {
		insights = append(insights, card)
	}

	// (c) Value outliers (> interpolated p95 within a (type, currency) cohort).
	groups := computeValueOutliers(active, insightsOutlierMinSample)
	for i := range groups {
		if i >= insightsOutlierMaxCards {
			break
		}
		insights = append(insights, buildValueOutlierInsight(groups[i]))
	}

	// (d) Counterparty concentration on the dominant-currency active book.
	if conc, ok := computeCounterpartyConcentration(active, insightsConcentrationMinContracts); ok && conc.Share >= insightsConcentrationMinShare {
		insights = append(insights, buildConcentrationInsight(conc))
	}

	// (e) Stale drafts: no activity for staleDays or more.
	if staleDrafts, oldestDays := computeStaleDrafts(drafts, now, staleDays); len(staleDrafts) > 0 {
		insights = append(insights, buildStaleDraftInsight(staleDrafts, oldestDays, staleDays))
	}

	rankInsights(insights)
	return &ContractInsightsReport{
		Insights:       insights,
		GeneratedAt:    now,
		WindowDays:     windowDays,
		StaleDraftDays: staleDays,
		ScannedActive:  len(active),
		Truncated:      totalActive > len(active) || totalDrafts > len(drafts),
	}, nil
}

// ---- (b) renewal opt-out trap calculator ----

// renewalOptOutTrap is one auto-renewing contract whose opt-out deadline
// (expiry_date - renewal_notice_days) falls inside the warning window.
type renewalOptOutTrap struct {
	Contract        model.Contract
	OptOutDeadline  time.Time
	DaysUntilOptOut int
}

// computeRenewalOptOutTraps keeps auto-renewing contracts whose opt-out
// deadline lands within [asOf, asOf+windowDays]. Contracts without an expiry
// date, already past their deadline, or already expired are excluded (they
// need a different card, not a "closing soon" one). Results sort by deadline
// ascending (most urgent first), then title for stability.
func computeRenewalOptOutTraps(contracts []model.Contract, asOf time.Time, windowDays int) []renewalOptOutTrap {
	asOfDate := normalizeDate(asOf)
	traps := make([]renewalOptOutTrap, 0, len(contracts))
	for i := range contracts {
		contract := contracts[i]
		if !contract.AutoRenew || contract.ExpiryDate == nil {
			continue
		}
		if daysBetween(asOfDate, *contract.ExpiryDate) < 0 {
			continue // already expired
		}
		noticeDays := contract.RenewalNoticeDays
		if noticeDays < 0 {
			noticeDays = 0
		}
		deadline := normalizeDate(contract.ExpiryDate.AddDate(0, 0, -noticeDays))
		days := daysBetween(asOfDate, deadline)
		if days < 0 || days > windowDays {
			continue
		}
		traps = append(traps, renewalOptOutTrap{Contract: contract, OptOutDeadline: deadline, DaysUntilOptOut: days})
	}
	sort.SliceStable(traps, func(i, j int) bool {
		if !traps[i].OptOutDeadline.Equal(traps[j].OptOutDeadline) {
			return traps[i].OptOutDeadline.Before(traps[j].OptOutDeadline)
		}
		return traps[i].Contract.Title < traps[j].Contract.Title
	})
	return traps
}

// ---- (c) value outlier calculator ----

// valueOutlierGroup is one (type, currency) cohort with contracts whose value
// exceeds the cohort's interpolated 95th percentile.
type valueOutlierGroup struct {
	ContractType model.ContractType
	Currency     string
	P95          float64
	SampleSize   int
	MaxValue     float64
	Outliers     []model.Contract // sorted by value descending
}

// computeValueOutliers groups valued contracts by (type, currency), computes
// the interpolated p95 per cohort of at least minSample contracts, and flags
// contracts strictly above it. Cohorts without outliers are dropped; groups
// sort by their largest outlier value descending.
func computeValueOutliers(contracts []model.Contract, minSample int) []valueOutlierGroup {
	type cohortKey struct {
		contractType model.ContractType
		currency     string
	}
	cohorts := map[cohortKey][]model.Contract{}
	for i := range contracts {
		contract := contracts[i]
		if contract.TotalValue == nil || *contract.TotalValue <= 0 {
			continue
		}
		key := cohortKey{contractType: contract.Type, currency: strings.ToUpper(strings.TrimSpace(contract.Currency))}
		cohorts[key] = append(cohorts[key], contract)
	}
	groups := make([]valueOutlierGroup, 0, len(cohorts))
	for key, members := range cohorts {
		if len(members) < minSample {
			continue
		}
		values := make([]float64, 0, len(members))
		for i := range members {
			values = append(values, *members[i].TotalValue)
		}
		sort.Float64s(values)
		p95 := interpolatedPercentile(values, 0.95)
		outliers := make([]model.Contract, 0, 2)
		for i := range members {
			if *members[i].TotalValue > p95 {
				outliers = append(outliers, members[i])
			}
		}
		if len(outliers) == 0 {
			continue
		}
		sort.SliceStable(outliers, func(i, j int) bool {
			return *outliers[i].TotalValue > *outliers[j].TotalValue
		})
		groups = append(groups, valueOutlierGroup{
			ContractType: key.contractType,
			Currency:     key.currency,
			P95:          p95,
			SampleSize:   len(members),
			MaxValue:     *outliers[0].TotalValue,
			Outliers:     outliers,
		})
	}
	sort.SliceStable(groups, func(i, j int) bool {
		if groups[i].MaxValue != groups[j].MaxValue {
			return groups[i].MaxValue > groups[j].MaxValue
		}
		return groups[i].ContractType < groups[j].ContractType
	})
	return groups
}

// interpolatedPercentile computes the linearly interpolated percentile of an
// ascending-sorted slice (Excel PERCENTILE.INC semantics). Unlike nearest-rank,
// interpolation keeps p95 < max on small samples so a genuine top outlier can
// still exceed it.
func interpolatedPercentile(sorted []float64, p float64) float64 {
	n := len(sorted)
	if n == 0 {
		return 0
	}
	if n == 1 {
		return sorted[0]
	}
	idx := p * float64(n-1)
	lo := int(math.Floor(idx))
	hi := int(math.Ceil(idx))
	if lo == hi {
		return sorted[lo]
	}
	frac := idx - float64(lo)
	return sorted[lo]*(1-frac) + sorted[hi]*frac
}

// ---- (d) counterparty concentration calculator ----

// counterpartyConcentration is the top party_b share of total active value
// within the dominant-currency cohort.
type counterpartyConcentration struct {
	PartyB         string
	Currency       string
	PartyValue     float64
	PortfolioValue float64
	Share          float64
	ContractCount  int
	ContractIDs    []uuid.UUID
}

// computeCounterpartyConcentration measures the top counterparty's share of
// total contract value. Values are only comparable within one currency, so the
// measure runs on the dominant currency cohort (largest total value); cohorts
// below minContracts valued contracts are skipped as statistically meaningless.
func computeCounterpartyConcentration(contracts []model.Contract, minContracts int) (counterpartyConcentration, bool) {
	byCurrency := map[string][]model.Contract{}
	for i := range contracts {
		contract := contracts[i]
		if contract.TotalValue == nil || *contract.TotalValue <= 0 || strings.TrimSpace(contract.PartyBName) == "" {
			continue
		}
		currency := strings.ToUpper(strings.TrimSpace(contract.Currency))
		byCurrency[currency] = append(byCurrency[currency], contract)
	}
	dominantCurrency := ""
	dominantTotal := 0.0
	for currency, members := range byCurrency {
		total := 0.0
		for i := range members {
			total += *members[i].TotalValue
		}
		if total > dominantTotal || (total == dominantTotal && currency < dominantCurrency) {
			dominantCurrency = currency
			dominantTotal = total
		}
	}
	members := byCurrency[dominantCurrency]
	if len(members) < minContracts || dominantTotal <= 0 {
		return counterpartyConcentration{}, false
	}
	type partyAgg struct {
		name  string
		value float64
		ids   []uuid.UUID
	}
	parties := map[string]*partyAgg{}
	for i := range members {
		contract := members[i]
		key := strings.ToLower(strings.TrimSpace(contract.PartyBName))
		agg, ok := parties[key]
		if !ok {
			agg = &partyAgg{name: strings.TrimSpace(contract.PartyBName)}
			parties[key] = agg
		}
		agg.value += *contract.TotalValue
		agg.ids = append(agg.ids, contract.ID)
	}
	var top *partyAgg
	for _, agg := range parties {
		if top == nil || agg.value > top.value || (agg.value == top.value && agg.name < top.name) {
			top = agg
		}
	}
	if top == nil {
		return counterpartyConcentration{}, false
	}
	return counterpartyConcentration{
		PartyB:         top.name,
		Currency:       dominantCurrency,
		PartyValue:     top.value,
		PortfolioValue: dominantTotal,
		Share:          top.value / dominantTotal,
		ContractCount:  len(top.ids),
		ContractIDs:    top.ids,
	}, true
}

// ---- (e) stale draft calculator ----

// computeStaleDrafts keeps draft contracts with no update for staleDays or
// more, sorted oldest-first, and returns the age in days of the stalest one.
func computeStaleDrafts(contracts []model.Contract, asOf time.Time, staleDays int) ([]model.Contract, int) {
	stale := make([]model.Contract, 0, len(contracts))
	oldest := 0
	for i := range contracts {
		contract := contracts[i]
		if contract.Status != model.ContractStatusDraft {
			continue
		}
		age := int(asOf.Sub(contract.UpdatedAt).Hours() / 24)
		if age < staleDays {
			continue
		}
		stale = append(stale, contract)
		if age > oldest {
			oldest = age
		}
	}
	sort.SliceStable(stale, func(i, j int) bool {
		return stale[i].UpdatedAt.Before(stale[j].UpdatedAt)
	})
	return stale, oldest
}

// ---- card builders ----

func buildMissingClauseInsight(rows []model.PlaybookComplianceRow) (ContractInsight, bool) {
	offenders := make([]model.PlaybookComplianceRow, 0, len(rows))
	for i := range rows {
		if rows[i].MissingCount > 0 {
			offenders = append(offenders, rows[i])
		}
	}
	if len(offenders) == 0 {
		return ContractInsight{}, false
	}
	sort.SliceStable(offenders, func(i, j int) bool {
		if offenders[i].ComplianceScore != offenders[j].ComplianceScore {
			return offenders[i].ComplianceScore < offenders[j].ComplianceScore
		}
		return offenders[i].MissingCount > offenders[j].MissingCount
	})
	worst := offenders[0].ComplianceScore
	missingTotal := 0
	ids := make([]uuid.UUID, 0, insightsMaxContractIDs)
	for i := range offenders {
		missingTotal += offenders[i].MissingCount
		if len(ids) < insightsMaxContractIDs {
			ids = append(ids, offenders[i].ContractID)
		}
	}
	severity := model.RiskLevelMedium
	switch {
	case worst < 40:
		severity = model.RiskLevelCritical
	case worst < 70:
		severity = model.RiskLevelHigh
	}
	return ContractInsight{
		ID:          ContractInsightKindMissingClause,
		Kind:        ContractInsightKindMissingClause,
		Severity:    severity,
		TitleEN:     "Contracts missing mandatory clauses",
		TitleAR:     "عقود تفتقد بنودًا إلزامية",
		DetailEN:    fmt.Sprintf("%d contract(s) are missing required playbook clauses (e.g. data protection); lowest compliance score is %.0f%%.", len(offenders), worst),
		DetailAR:    fmt.Sprintf("%d عقدًا يفتقد بنودًا إلزامية بحسب دليل البنود المعتمد (مثل بند حماية البيانات)؛ وأدنى درجة التزام هي %.0f%%.", len(offenders), worst),
		ContractIDs: ids,
		Metric: map[string]any{
			"contracts":              len(offenders),
			"missing_total":          missingTotal,
			"worst_compliance_score": worst,
		},
	}, true
}

func buildRenewalOptOutInsight(traps []renewalOptOutTrap, windowDays int) (ContractInsight, bool) {
	if len(traps) == 0 {
		return ContractInsight{}, false
	}
	within7 := 0
	ids := make([]uuid.UUID, 0, insightsMaxContractIDs)
	for i := range traps {
		if traps[i].DaysUntilOptOut <= 7 {
			within7++
		}
		if len(ids) < insightsMaxContractIDs {
			ids = append(ids, traps[i].Contract.ID)
		}
	}
	severity := model.RiskLevelHigh
	if within7 > 0 {
		severity = model.RiskLevelCritical
	}
	earliest := traps[0].OptOutDeadline.Format("2006-01-02")
	return ContractInsight{
		ID:          ContractInsightKindRenewalOptOut,
		Kind:        ContractInsightKindRenewalOptOut,
		Severity:    severity,
		TitleEN:     "Auto-renew opt-out windows closing",
		TitleAR:     "نوافذ إلغاء التجديد التلقائي تُغلق قريبًا",
		DetailEN:    fmt.Sprintf("%d auto-renewing contract(s) reach their opt-out deadline within %d days; the earliest deadline is %s.", len(traps), windowDays, earliest),
		DetailAR:    fmt.Sprintf("%d عقدًا بتجديد تلقائي تنتهي مهلة الاعتراض على تجديده خلال %d يومًا؛ وأقرب موعد نهائي هو %s.", len(traps), windowDays, earliest),
		ContractIDs: ids,
		Metric: map[string]any{
			"contracts":         len(traps),
			"closing_within_7d": within7,
			"window_days":       windowDays,
			"next_deadline":     earliest,
		},
	}, true
}

func buildValueOutlierInsight(group valueOutlierGroup) ContractInsight {
	severity := model.RiskLevelMedium
	if group.P95 > 0 && group.MaxValue > 2*group.P95 {
		severity = model.RiskLevelHigh
	}
	ids := make([]uuid.UUID, 0, insightsMaxContractIDs)
	for i := range group.Outliers {
		if len(ids) >= insightsMaxContractIDs {
			break
		}
		ids = append(ids, group.Outliers[i].ID)
	}
	return ContractInsight{
		ID:          fmt.Sprintf("%s:%s:%s", ContractInsightKindValueOutlier, group.ContractType, group.Currency),
		Kind:        ContractInsightKindValueOutlier,
		Severity:    severity,
		TitleEN:     fmt.Sprintf("Unusually high contract values: %s", group.ContractType),
		TitleAR:     fmt.Sprintf("قيم عقود مرتفعة بشكل استثنائي: %s", group.ContractType),
		DetailEN:    fmt.Sprintf("%d %s contract(s) exceed the cohort's 95th-percentile value (%.0f %s); the highest is %.0f %s.", len(group.Outliers), group.ContractType, group.P95, group.Currency, group.MaxValue, group.Currency),
		DetailAR:    fmt.Sprintf("%d من عقود %s تتجاوز قيمتها المئين الخامس والتسعين للفئة (%.0f %s)؛ وأعلى قيمة هي %.0f %s.", len(group.Outliers), group.ContractType, group.P95, group.Currency, group.MaxValue, group.Currency),
		ContractIDs: ids,
		Metric: map[string]any{
			"contract_type": string(group.ContractType),
			"currency":      group.Currency,
			"p95":           group.P95,
			"max_value":     group.MaxValue,
			"outliers":      len(group.Outliers),
			"sample_size":   group.SampleSize,
		},
	}
}

func buildConcentrationInsight(conc counterpartyConcentration) ContractInsight {
	severity := model.RiskLevelMedium
	switch {
	case conc.Share >= 0.5:
		severity = model.RiskLevelCritical
	case conc.Share >= 0.35:
		severity = model.RiskLevelHigh
	}
	ids := conc.ContractIDs
	if len(ids) > insightsMaxContractIDs {
		ids = ids[:insightsMaxContractIDs]
	}
	sharePct := conc.Share * 100
	return ContractInsight{
		ID:          ContractInsightKindConcentration,
		Kind:        ContractInsightKindConcentration,
		Severity:    severity,
		TitleEN:     "Counterparty concentration risk",
		TitleAR:     "مخاطر تركّز الأطراف المقابلة",
		DetailEN:    fmt.Sprintf("%s accounts for %.0f%% of total active contract value (%.0f of %.0f %s) across %d contract(s).", conc.PartyB, sharePct, conc.PartyValue, conc.PortfolioValue, conc.Currency, conc.ContractCount),
		DetailAR:    fmt.Sprintf("يمثل %s نسبة %.0f%% من إجمالي قيمة العقود النشطة (%.0f من %.0f %s) عبر %d عقدًا.", conc.PartyB, sharePct, conc.PartyValue, conc.PortfolioValue, conc.Currency, conc.ContractCount),
		ContractIDs: ids,
		Metric: map[string]any{
			"party_b":         conc.PartyB,
			"share_pct":       sharePct,
			"party_value":     conc.PartyValue,
			"portfolio_value": conc.PortfolioValue,
			"currency":        conc.Currency,
			"contracts":       conc.ContractCount,
		},
	}
}

func buildStaleDraftInsight(staleDrafts []model.Contract, oldestDays, staleDays int) ContractInsight {
	severity := model.RiskLevelMedium
	if oldestDays >= insightsStaleDraftEscalationDays {
		severity = model.RiskLevelHigh
	}
	ids := make([]uuid.UUID, 0, insightsMaxContractIDs)
	for i := range staleDrafts {
		if len(ids) >= insightsMaxContractIDs {
			break
		}
		ids = append(ids, staleDrafts[i].ID)
	}
	return ContractInsight{
		ID:          ContractInsightKindStaleDraft,
		Kind:        ContractInsightKindStaleDraft,
		Severity:    severity,
		TitleEN:     "Stale draft contracts",
		TitleAR:     "مسودات عقود راكدة",
		DetailEN:    fmt.Sprintf("%d draft contract(s) have had no activity for %d+ days; the oldest has been idle for %d days.", len(staleDrafts), staleDays, oldestDays),
		DetailAR:    fmt.Sprintf("%d مسودة عقد بلا أي نشاط منذ %d يومًا أو أكثر؛ وأقدمها راكدة منذ %d يومًا.", len(staleDrafts), staleDays, oldestDays),
		ContractIDs: ids,
		Metric: map[string]any{
			"contracts":      len(staleDrafts),
			"threshold_days": staleDays,
			"oldest_days":    oldestDays,
		},
	}
}

// ---- ranking ----

func insightSeverityRank(level model.RiskLevel) int {
	switch level {
	case model.RiskLevelCritical:
		return 4
	case model.RiskLevelHigh:
		return 3
	case model.RiskLevelMedium:
		return 2
	case model.RiskLevelLow:
		return 1
	default:
		return 0
	}
}

// rankInsights orders cards most-severe first; ties break on affected-contract
// count (more first) then card id for a stable feed.
func rankInsights(insights []ContractInsight) {
	sort.SliceStable(insights, func(i, j int) bool {
		ri, rj := insightSeverityRank(insights[i].Severity), insightSeverityRank(insights[j].Severity)
		if ri != rj {
			return ri > rj
		}
		if len(insights[i].ContractIDs) != len(insights[j].ContractIDs) {
			return len(insights[i].ContractIDs) > len(insights[j].ContractIDs)
		}
		return insights[i].ID < insights[j].ID
	})
}
