package service

import (
	"math"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func insightFloat(v float64) *float64 { return &v }

func insightDate(t *testing.T, value string) *time.Time {
	t.Helper()
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		t.Fatalf("parse date %q: %v", value, err)
	}
	return &parsed
}

func TestComputeRenewalOptOutTraps_WindowAndOrdering(t *testing.T) {
	asOf := time.Date(2026, 7, 9, 10, 30, 0, 0, time.UTC)

	inWindow := model.Contract{
		ID: uuid.New(), Title: "Cleaning services", AutoRenew: true,
		ExpiryDate: insightDate(t, "2026-08-18"), RenewalNoticeDays: 15,
	} // opt-out = 2026-08-03 -> 25 days out
	boundaryToday := model.Contract{
		ID: uuid.New(), Title: "Fleet leasing", AutoRenew: true,
		ExpiryDate: insightDate(t, "2026-08-08"), RenewalNoticeDays: 30,
	} // opt-out = 2026-07-09 -> 0 days out (boundary: due today)
	beyondWindow := model.Contract{
		ID: uuid.New(), Title: "Software licence", AutoRenew: true,
		ExpiryDate: insightDate(t, "2026-08-18"), RenewalNoticeDays: 5,
	} // opt-out = 2026-08-13 -> 35 days out (> 30)
	notAutoRenew := model.Contract{
		ID: uuid.New(), Title: "One-off consulting", AutoRenew: false,
		ExpiryDate: insightDate(t, "2026-07-20"), RenewalNoticeDays: 10,
	}
	deadlinePassed := model.Contract{
		ID: uuid.New(), Title: "Security services", AutoRenew: true,
		ExpiryDate: insightDate(t, "2026-07-19"), RenewalNoticeDays: 20,
	} // opt-out = 2026-06-29 -> already missed
	noExpiry := model.Contract{
		ID: uuid.New(), Title: "Evergreen NDA", AutoRenew: true,
		RenewalDate: insightDate(t, "2026-07-15"),
	}

	traps := computeRenewalOptOutTraps(
		[]model.Contract{inWindow, boundaryToday, beyondWindow, notAutoRenew, deadlinePassed, noExpiry},
		asOf, 30,
	)

	if len(traps) != 2 {
		t.Fatalf("traps = %d, want 2", len(traps))
	}
	if traps[0].Contract.ID != boundaryToday.ID {
		t.Fatalf("traps[0] = %s, want boundary contract first (most urgent)", traps[0].Contract.Title)
	}
	if traps[0].DaysUntilOptOut != 0 {
		t.Fatalf("traps[0].DaysUntilOptOut = %d, want 0", traps[0].DaysUntilOptOut)
	}
	if traps[1].Contract.ID != inWindow.ID {
		t.Fatalf("traps[1] = %s, want in-window contract", traps[1].Contract.Title)
	}
	if traps[1].DaysUntilOptOut != 25 {
		t.Fatalf("traps[1].DaysUntilOptOut = %d, want 25", traps[1].DaysUntilOptOut)
	}
	wantDeadline := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC)
	if !traps[1].OptOutDeadline.Equal(wantDeadline) {
		t.Fatalf("traps[1].OptOutDeadline = %s, want %s", traps[1].OptOutDeadline, wantDeadline)
	}
}

func TestComputeRenewalOptOutTraps_NegativeNoticeTreatedAsZero(t *testing.T) {
	asOf := time.Date(2026, 7, 9, 0, 0, 0, 0, time.UTC)
	contract := model.Contract{
		ID: uuid.New(), Title: "Odd data", AutoRenew: true,
		ExpiryDate: insightDate(t, "2026-07-19"), RenewalNoticeDays: -5,
	}
	traps := computeRenewalOptOutTraps([]model.Contract{contract}, asOf, 30)
	if len(traps) != 1 {
		t.Fatalf("traps = %d, want 1", len(traps))
	}
	// Notice clamped to 0 -> deadline equals expiry (10 days out).
	if traps[0].DaysUntilOptOut != 10 {
		t.Fatalf("DaysUntilOptOut = %d, want 10", traps[0].DaysUntilOptOut)
	}
}

func TestBuildRenewalOptOutInsight_SeverityEscalatesWithin7Days(t *testing.T) {
	urgent := renewalOptOutTrap{
		Contract:        model.Contract{ID: uuid.New(), Title: "Urgent"},
		OptOutDeadline:  time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC),
		DaysUntilOptOut: 3,
	}
	relaxed := renewalOptOutTrap{
		Contract:        model.Contract{ID: uuid.New(), Title: "Relaxed"},
		OptOutDeadline:  time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC),
		DaysUntilOptOut: 21,
	}

	card, ok := buildRenewalOptOutInsight([]renewalOptOutTrap{urgent, relaxed}, 30)
	if !ok {
		t.Fatal("buildRenewalOptOutInsight ok = false, want card")
	}
	if card.Severity != model.RiskLevelCritical {
		t.Fatalf("severity = %s, want critical (deadline within 7d)", card.Severity)
	}
	if card.Metric["next_deadline"] != "2026-07-12" {
		t.Fatalf("next_deadline = %v, want 2026-07-12", card.Metric["next_deadline"])
	}
	if card.TitleAR == "" || card.DetailAR == "" {
		t.Fatal("Arabic title/detail must be populated")
	}

	cardHighOnly, ok := buildRenewalOptOutInsight([]renewalOptOutTrap{relaxed}, 30)
	if !ok {
		t.Fatal("buildRenewalOptOutInsight ok = false, want card")
	}
	if cardHighOnly.Severity != model.RiskLevelHigh {
		t.Fatalf("severity = %s, want high (no deadline within 7d)", cardHighOnly.Severity)
	}

	if _, ok := buildRenewalOptOutInsight(nil, 30); ok {
		t.Fatal("empty traps must not yield a card")
	}
}

func TestComputeValueOutliers_FlagsAboveInterpolatedP95(t *testing.T) {
	// Nine vendor contracts 100k..180k plus a 1M spike. Interpolated p95 over
	// [100..180,1000] (thousands) = 180*0.45 + 1000*0.55 = 631k.
	contracts := make([]model.Contract, 0, 12)
	for i := 0; i < 9; i++ {
		contracts = append(contracts, model.Contract{
			ID: uuid.New(), Type: model.ContractTypeVendor, Currency: "SAR",
			TotalValue: insightFloat(float64(100_000 + i*10_000)),
		})
	}
	spike := model.Contract{
		ID: uuid.New(), Type: model.ContractTypeVendor, Currency: "SAR",
		TotalValue: insightFloat(1_000_000),
	}
	contracts = append(contracts, spike)
	// A small cohort below the sample floor must not produce a group.
	contracts = append(contracts,
		model.Contract{ID: uuid.New(), Type: model.ContractTypeNDA, Currency: "SAR", TotalValue: insightFloat(50_000)},
		model.Contract{ID: uuid.New(), Type: model.ContractTypeNDA, Currency: "SAR", TotalValue: insightFloat(9_000_000)},
	)
	// Unvalued contracts are ignored entirely.
	contracts = append(contracts, model.Contract{ID: uuid.New(), Type: model.ContractTypeVendor, Currency: "SAR"})

	groups := computeValueOutliers(contracts, insightsOutlierMinSample)

	if len(groups) != 1 {
		t.Fatalf("groups = %d, want 1 (only the vendor/SAR cohort qualifies)", len(groups))
	}
	group := groups[0]
	if group.ContractType != model.ContractTypeVendor || group.Currency != "SAR" {
		t.Fatalf("group = %s/%s, want vendor/SAR", group.ContractType, group.Currency)
	}
	if group.SampleSize != 10 {
		t.Fatalf("sample size = %d, want 10", group.SampleSize)
	}
	if math.Abs(group.P95-631_000) > 1 {
		t.Fatalf("p95 = %.2f, want ~631000", group.P95)
	}
	if len(group.Outliers) != 1 || group.Outliers[0].ID != spike.ID {
		t.Fatalf("outliers = %d, want exactly the 1M spike", len(group.Outliers))
	}
	if group.MaxValue != 1_000_000 {
		t.Fatalf("max value = %.0f, want 1000000", group.MaxValue)
	}
}

func TestComputeValueOutliers_UniformCohortHasNoOutliers(t *testing.T) {
	contracts := make([]model.Contract, 0, 8)
	for i := 0; i < 8; i++ {
		contracts = append(contracts, model.Contract{
			ID: uuid.New(), Type: model.ContractTypeLease, Currency: "SAR",
			TotalValue: insightFloat(250_000),
		})
	}
	if groups := computeValueOutliers(contracts, insightsOutlierMinSample); len(groups) != 0 {
		t.Fatalf("groups = %d, want 0 (uniform values cannot exceed p95)", len(groups))
	}
}

func TestInterpolatedPercentile(t *testing.T) {
	if got := interpolatedPercentile(nil, 0.95); got != 0 {
		t.Fatalf("empty percentile = %f, want 0", got)
	}
	if got := interpolatedPercentile([]float64{42}, 0.95); got != 42 {
		t.Fatalf("single percentile = %f, want 42", got)
	}
	// Median of an even-length slice interpolates between the middle pair.
	if got := interpolatedPercentile([]float64{1, 2, 3, 4}, 0.5); math.Abs(got-2.5) > 1e-9 {
		t.Fatalf("median = %f, want 2.5", got)
	}
}

func TestComputeCounterpartyConcentration_TopPartyDominantCurrency(t *testing.T) {
	acmeA := model.Contract{ID: uuid.New(), PartyBName: "Acme Corp", Currency: "SAR", TotalValue: insightFloat(400_000)}
	acmeB := model.Contract{ID: uuid.New(), PartyBName: "acme corp ", Currency: "SAR", TotalValue: insightFloat(200_000)}
	other1 := model.Contract{ID: uuid.New(), PartyBName: "Beta LLC", Currency: "SAR", TotalValue: insightFloat(250_000)}
	other2 := model.Contract{ID: uuid.New(), PartyBName: "Gamma Est", Currency: "SAR", TotalValue: insightFloat(150_000)}
	// A minor USD book must not dilute the dominant SAR cohort.
	usd := model.Contract{ID: uuid.New(), PartyBName: "Dollar Co", Currency: "USD", TotalValue: insightFloat(90_000)}

	conc, ok := computeCounterpartyConcentration([]model.Contract{acmeA, acmeB, other1, other2, usd}, insightsConcentrationMinContracts)
	if !ok {
		t.Fatal("ok = false, want concentration result")
	}
	if conc.PartyB != "Acme Corp" {
		t.Fatalf("party = %q, want Acme Corp (case/space-folded aggregation)", conc.PartyB)
	}
	if conc.Currency != "SAR" {
		t.Fatalf("currency = %q, want SAR", conc.Currency)
	}
	if math.Abs(conc.Share-0.6) > 1e-9 {
		t.Fatalf("share = %f, want 0.6", conc.Share)
	}
	if conc.ContractCount != 2 || len(conc.ContractIDs) != 2 {
		t.Fatalf("contract count = %d/%d ids, want 2/2", conc.ContractCount, len(conc.ContractIDs))
	}

	if _, ok := computeCounterpartyConcentration([]model.Contract{acmeA, usd}, insightsConcentrationMinContracts); ok {
		t.Fatal("cohort below the minimum contract floor must not report concentration")
	}
}

func TestComputeStaleDrafts(t *testing.T) {
	asOf := time.Date(2026, 7, 9, 0, 0, 0, 0, time.UTC)
	staleOld := model.Contract{ID: uuid.New(), Status: model.ContractStatusDraft, UpdatedAt: asOf.AddDate(0, 0, -45)}
	staleBoundary := model.Contract{ID: uuid.New(), Status: model.ContractStatusDraft, UpdatedAt: asOf.AddDate(0, 0, -30)}
	fresh := model.Contract{ID: uuid.New(), Status: model.ContractStatusDraft, UpdatedAt: asOf.AddDate(0, 0, -10)}
	notDraft := model.Contract{ID: uuid.New(), Status: model.ContractStatusActive, UpdatedAt: asOf.AddDate(0, 0, -100)}

	stale, oldest := computeStaleDrafts([]model.Contract{fresh, staleBoundary, staleOld, notDraft}, asOf, 30)

	if len(stale) != 2 {
		t.Fatalf("stale = %d, want 2", len(stale))
	}
	if stale[0].ID != staleOld.ID {
		t.Fatal("stale drafts must sort oldest-first")
	}
	if oldest != 45 {
		t.Fatalf("oldest = %d, want 45", oldest)
	}
}

func TestRankInsights_SeverityThenReachThenID(t *testing.T) {
	medium := ContractInsight{ID: "b-medium", Severity: model.RiskLevelMedium}
	criticalSmall := ContractInsight{ID: "z-critical", Severity: model.RiskLevelCritical, ContractIDs: []uuid.UUID{uuid.New()}}
	highWide := ContractInsight{ID: "a-high", Severity: model.RiskLevelHigh, ContractIDs: []uuid.UUID{uuid.New(), uuid.New()}}
	highNarrow := ContractInsight{ID: "c-high", Severity: model.RiskLevelHigh, ContractIDs: []uuid.UUID{uuid.New()}}

	insights := []ContractInsight{medium, highNarrow, highWide, criticalSmall}
	rankInsights(insights)

	wantOrder := []string{"z-critical", "a-high", "c-high", "b-medium"}
	for i, want := range wantOrder {
		if insights[i].ID != want {
			t.Fatalf("insights[%d].ID = %s, want %s", i, insights[i].ID, want)
		}
	}
}

func TestBuildMissingClauseInsight_SeverityFromWorstScore(t *testing.T) {
	rows := []model.PlaybookComplianceRow{
		{ContractID: uuid.New(), ComplianceScore: 85, MissingCount: 0}, // compliant on missing -> excluded
		{ContractID: uuid.New(), ComplianceScore: 65, MissingCount: 1},
		{ContractID: uuid.New(), ComplianceScore: 30, MissingCount: 3},
	}
	card, ok := buildMissingClauseInsight(rows)
	if !ok {
		t.Fatal("ok = false, want card")
	}
	if card.Severity != model.RiskLevelCritical {
		t.Fatalf("severity = %s, want critical (worst score 30)", card.Severity)
	}
	if len(card.ContractIDs) != 2 {
		t.Fatalf("contract ids = %d, want 2 (zero-missing row excluded)", len(card.ContractIDs))
	}
	if card.ContractIDs[0] != rows[2].ContractID {
		t.Fatal("worst-scoring contract must rank first")
	}
	if card.Metric["missing_total"] != 4 {
		t.Fatalf("missing_total = %v, want 4", card.Metric["missing_total"])
	}

	if _, ok := buildMissingClauseInsight([]model.PlaybookComplianceRow{{ComplianceScore: 90}}); ok {
		t.Fatal("no missing clauses must not yield a card")
	}
}
