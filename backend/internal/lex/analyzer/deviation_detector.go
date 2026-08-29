package analyzer

import (
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// DefaultDeviationSimilarityThreshold is the minimum normalized token-set
// similarity (0..1) for a present clause to be considered compliant with the
// playbook standard. Below it the clause is flagged ALTERED. A per-clause
// override on the playbook clause takes precedence.
const DefaultDeviationSimilarityThreshold = 0.6

// DeviationDetector (WTQ-RSK-02) compares a contract's extracted clauses against
// an approved clause playbook and reports MISSING, ALTERED, and EXTRA
// deviations. It is pure/deterministic and has no external dependencies, so it
// is fully unit-testable.
type DeviationDetector struct {
	threshold    float64
	includeExtra bool
}

// DeviationDetectorOption configures a DeviationDetector.
type DeviationDetectorOption func(*DeviationDetector)

// WithDeviationThreshold overrides the default similarity threshold.
func WithDeviationThreshold(threshold float64) DeviationDetectorOption {
	return func(d *DeviationDetector) {
		if threshold > 0 && threshold <= 1 {
			d.threshold = threshold
		}
	}
}

// WithExtraClauseDetection toggles reporting of EXTRA (non-standard) clauses.
func WithExtraClauseDetection(include bool) DeviationDetectorOption {
	return func(d *DeviationDetector) { d.includeExtra = include }
}

// NewDeviationDetector builds a detector with the default threshold and EXTRA
// clause detection enabled.
func NewDeviationDetector(opts ...DeviationDetectorOption) *DeviationDetector {
	d := &DeviationDetector{threshold: DefaultDeviationSimilarityThreshold, includeExtra: true}
	for _, opt := range opts {
		opt(d)
	}
	return d
}

// Detect compares the contract's extracted clauses against the playbook and
// returns a deviation report. contractID identifies the contract for the report
// header; clauses are the extractor output; playbook is the applicable playbook.
func (d *DeviationDetector) Detect(contractID uuid.UUID, clauses []model.ExtractedClause, playbook *model.ClausePlaybook, now time.Time) *model.ClauseDeviationReport {
	report := &model.ClauseDeviationReport{
		ContractID:  contractID,
		Threshold:   d.threshold,
		Matched:     playbook != nil,
		Deviations:  []model.ClauseDeviation{},
		GeneratedAt: now,
	}
	if playbook == nil {
		report.Reason = "no applicable clause playbook for this contract type"
		report.ComplianceScore = 0
		return report
	}
	report.PlaybookID = playbook.ID
	report.PlaybookName = playbook.Name
	report.ContractType = playbook.ContractType
	report.TotalStandard = len(playbook.Clauses)
	report.Reason = fmt.Sprintf("compared against playbook %q for contract type %s", playbook.Name, playbook.ContractType)

	// Index the contract's clauses by type. A contract may carry several clauses
	// of the same type (one per matched section); keep them all so ALTERED uses
	// the BEST-matching one (highest similarity to the standard text).
	byType := map[model.ClauseType][]model.ExtractedClause{}
	standardTypes := map[model.ClauseType]bool{}
	for _, clause := range clauses {
		byType[clause.ClauseType] = append(byType[clause.ClauseType], clause)
	}

	var weightedTotal, weightedCompliant float64
	for _, std := range playbook.Clauses {
		standardTypes[std.ClauseType] = true
		weight := std.RiskWeight
		if weight <= 0 {
			weight = 1.0
		}
		threshold := std.SimilarityThreshold
		if threshold <= 0 || threshold > 1 {
			threshold = d.threshold
		}
		weightedTotal += weight

		present := byType[std.ClauseType]
		if len(present) == 0 {
			if std.Required {
				report.Deviations = append(report.Deviations, model.ClauseDeviation{
					Kind:            model.ClauseDeviationMissing,
					ClauseType:      std.ClauseType,
					Title:           standardTitle(std),
					Required:        true,
					RiskWeight:      weight,
					Severity:        missingSeverity(weight),
					ExpectedExcerpt: excerpt(std.StandardText),
					Message:         fmt.Sprintf("required %s clause is missing from the contract", humanClauseType(std.ClauseType)),
				})
				report.MissingCount++
			}
			// Optional standard clause absent: not a deviation, but it does not
			// count toward compliance either.
			continue
		}

		// Find the best-matching present clause for this standard.
		bestSim := -1.0
		var best model.ExtractedClause
		for _, clause := range present {
			sim := jaccardSimilarity(std.StandardText, clause.Content)
			if sim > bestSim {
				bestSim = sim
				best = clause
			}
		}
		if bestSim >= threshold {
			weightedCompliant += weight
			continue
		}
		sim := bestSim
		thr := threshold
		section := nonEmptyPtr(best.SectionReference)
		report.Deviations = append(report.Deviations, model.ClauseDeviation{
			Kind:             model.ClauseDeviationAltered,
			ClauseType:       std.ClauseType,
			Title:            standardTitle(std),
			Required:         std.Required,
			Similarity:       &sim,
			Threshold:        &thr,
			RiskWeight:       weight,
			Severity:         alteredSeverity(weight, sim, thr),
			ContractClauseID: clauseIDPtr(best.ContractClauseID),
			SectionReference: section,
			ExpectedExcerpt:  excerpt(std.StandardText),
			ActualExcerpt:    excerpt(best.Content),
			Message: fmt.Sprintf(
				"%s clause text deviates from the standard (similarity %.0f%% < %.0f%% threshold)",
				humanClauseType(std.ClauseType), sim*100, thr*100,
			),
		})
		report.AlteredCount++
	}

	if d.includeExtra {
		// EXTRA: contract clause types not defined by the playbook. De-duplicate by
		// type and ignore the catch-all "other" type to reduce noise.
		seenExtra := map[model.ClauseType]bool{}
		for _, clause := range clauses {
			if standardTypes[clause.ClauseType] || clause.ClauseType == model.ClauseTypeOther {
				continue
			}
			if seenExtra[clause.ClauseType] {
				continue
			}
			seenExtra[clause.ClauseType] = true
			report.Deviations = append(report.Deviations, model.ClauseDeviation{
				Kind:             model.ClauseDeviationExtra,
				ClauseType:       clause.ClauseType,
				Title:            clauseExtraTitle(clause),
				Required:         false,
				RiskWeight:       1.0,
				Severity:         model.RiskLevelLow,
				ContractClauseID: clauseIDPtr(clause.ContractClauseID),
				SectionReference: nonEmptyPtr(clause.SectionReference),
				ActualExcerpt:    excerpt(clause.Content),
				Message:          fmt.Sprintf("non-standard %s clause present; not defined in the playbook", humanClauseType(clause.ClauseType)),
			})
			report.ExtraCount++
		}
	}

	if weightedTotal > 0 {
		report.ComplianceScore = round2(weightedCompliant / weightedTotal * 100)
	} else {
		report.ComplianceScore = 100
	}

	sortDeviations(report.Deviations)
	return report
}

func sortDeviations(deviations []model.ClauseDeviation) {
	kindRank := map[model.ClauseDeviationKind]int{
		model.ClauseDeviationMissing: 0,
		model.ClauseDeviationAltered: 1,
		model.ClauseDeviationExtra:   2,
	}
	sort.SliceStable(deviations, func(i, j int) bool {
		if kindRank[deviations[i].Kind] != kindRank[deviations[j].Kind] {
			return kindRank[deviations[i].Kind] < kindRank[deviations[j].Kind]
		}
		if deviations[i].RiskWeight != deviations[j].RiskWeight {
			return deviations[i].RiskWeight > deviations[j].RiskWeight
		}
		return deviations[i].ClauseType < deviations[j].ClauseType
	})
}

func standardTitle(std model.PlaybookClause) string {
	if strings.TrimSpace(std.Title) != "" {
		return std.Title
	}
	return humanClauseType(std.ClauseType)
}

func clauseExtraTitle(clause model.ExtractedClause) string {
	if strings.TrimSpace(clause.Title) != "" {
		return clause.Title
	}
	return humanClauseType(clause.ClauseType)
}

func missingSeverity(weight float64) model.RiskLevel {
	switch {
	case weight >= 0.9:
		return model.RiskLevelHigh
	case weight >= 0.5:
		return model.RiskLevelMedium
	default:
		return model.RiskLevelLow
	}
}

func alteredSeverity(weight, similarity, threshold float64) model.RiskLevel {
	// The further below threshold and the higher the weight, the worse.
	gap := threshold - similarity
	switch {
	case weight >= 0.9 && gap >= 0.4:
		return model.RiskLevelHigh
	case weight >= 0.5 && gap >= 0.2:
		return model.RiskLevelMedium
	default:
		return model.RiskLevelLow
	}
}

// clauseIDPtr returns a pointer to id when it is a non-zero uuid (a persisted
// contract clause), or nil for the zero uuid (a live document extraction with no
// stored clause row). Used to deep-link a deviation to a concrete contract clause.
func clauseIDPtr(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	out := id
	return &out
}

func nonEmptyPtr(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	out := s
	return &out
}

func excerpt(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	const limit = 160
	if len(text) <= limit {
		return text
	}
	return strings.TrimSpace(text[:limit]) + "…"
}

func round2(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100
}

// jaccardSimilarity returns the token-set Jaccard similarity (0..1) of two
// strings after normalization: lowercasing, splitting on non-alphanumeric runes,
// and dropping common boilerplate stop-words so that material wording changes
// drive the score rather than filler. Two empty/whitespace strings are treated
// as identical (1.0); one empty and one non-empty is 0.0.
func jaccardSimilarity(a, b string) float64 {
	setA := tokenSet(a)
	setB := tokenSet(b)
	if len(setA) == 0 && len(setB) == 0 {
		return 1.0
	}
	if len(setA) == 0 || len(setB) == 0 {
		return 0.0
	}
	intersection := 0
	for token := range setA {
		if setB[token] {
			intersection++
		}
	}
	union := len(setA) + len(setB) - intersection
	if union == 0 {
		return 1.0
	}
	return float64(intersection) / float64(union)
}

func tokenSet(s string) map[string]bool {
	fields := strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r)
	})
	set := make(map[string]bool, len(fields))
	for _, token := range fields {
		if len(token) < 2 || deviationStopWords[token] {
			continue
		}
		set[token] = true
	}
	return set
}

// deviationStopWords are high-frequency boilerplate tokens excluded from the
// similarity comparison so that material legal wording dominates the score.
var deviationStopWords = map[string]bool{
	"the": true, "and": true, "for": true, "this": true, "that": true,
	"with": true, "any": true, "all": true, "shall": true, "will": true,
	"such": true, "are": true, "was": true, "were": true, "been": true,
	"have": true, "has": true, "had": true, "not": true, "but": true,
	"its": true, "his": true, "her": true, "their": true, "from": true,
	"into": true, "upon": true, "under": true, "over": true, "out": true,
	"per": true, "may": true, "can": true, "each": true, "other": true,
	"which": true, "who": true, "whom": true, "than": true, "then": true,
}
