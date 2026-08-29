package llm

import (
	"strings"
	"time"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

const (
	clauseSystemPrompt = "You are ClarioLex, a contract analysis engine. Analyze the contract and extract clauses, parties, dates, monetary amounts, compliance flags, and key findings. You MUST call the emit_clause_analysis tool with structured arguments. Do NOT answer in prose. Use only verbatim substrings of the contract for text_span evidence. Risk levels must be one of: critical, high, medium, low, none."

	obligationSystemPrompt = "You are ClarioLex, a contract obligation extraction engine. Identify contractual obligations with concrete due dates. You MUST call the emit_obligations tool with structured arguments. Do NOT answer in prose. Every obligation requires a title and a due_date in YYYY-MM-DD format."
)

func (e *Enricher) clauseUserPrompt(contract *model.Contract, text string) string {
	var b strings.Builder
	b.WriteString("Contract type: ")
	b.WriteString(string(contract.Type))
	b.WriteString("\nContract title: ")
	b.WriteString(contract.Title)
	b.WriteString("\n\nContract text:\n")
	b.WriteString(truncateRunes(text, e.cfg.MaxInputRunes))
	return b.String()
}

func (e *Enricher) obligationUserPrompt(contract *model.Contract, text string) string {
	var b strings.Builder
	b.WriteString("Contract type: ")
	b.WriteString(string(contract.Type))
	b.WriteString("\nContract title: ")
	b.WriteString(contract.Title)
	b.WriteString("\n\nExtract every concrete obligation with a due date from the following contract text:\n")
	b.WriteString(truncateRunes(text, e.cfg.MaxInputRunes))
	return b.String()
}

// ---- Strict DTOs mirroring the tool schemas ----

type clauseToolArgs struct {
	Clauses         []clauseArg  `json:"clauses"`
	Parties         []partyArg   `json:"parties"`
	Dates           []dateArg    `json:"dates"`
	Amounts         []amountArg  `json:"amounts"`
	ComplianceFlags []flagArg    `json:"compliance_flags"`
	KeyFindings     []findingArg `json:"key_findings"`
}

type clauseArg struct {
	ClauseType       string   `json:"clause_type"`
	Title            string   `json:"title"`
	TextSpan         string   `json:"text_span"`
	SectionReference string   `json:"section_reference"`
	RiskLevel        string   `json:"risk_level"`
	RiskScore        float64  `json:"risk_score"`
	Rationale        string   `json:"rationale"`
	RiskKeywords     []string `json:"risk_keywords"`
	Recommendations  []string `json:"recommendations"`
	Confidence       float64  `json:"confidence"`
}

type partyArg struct {
	Name   string `json:"name"`
	Role   string `json:"role"`
	Source string `json:"source"`
}

type dateArg struct {
	Label  string `json:"label"`
	Value  string `json:"value"`
	Source string `json:"source"`
}

type amountArg struct {
	Label    string  `json:"label"`
	Currency string  `json:"currency"`
	Value    float64 `json:"value"`
	Source   string  `json:"source"`
}

type flagArg struct {
	Code             string `json:"code"`
	Title            string `json:"title"`
	Description      string `json:"description"`
	Severity         string `json:"severity"`
	SectionReference string `json:"section_reference"`
}

type findingArg struct {
	Title           string `json:"title"`
	Description     string `json:"description"`
	Severity        string `json:"severity"`
	ClauseReference string `json:"clause_reference"`
	Recommendation  string `json:"recommendation"`
	ClauseType      string `json:"clause_type"`
}

type obligationToolArgs struct {
	Obligations []obligationArg `json:"obligations"`
}

type obligationArg struct {
	Title           string  `json:"title"`
	Description     string  `json:"description"`
	ObligationType  string  `json:"obligation_type"`
	Priority        string  `json:"priority"`
	DueDate         string  `json:"due_date"`
	SourceReference string  `json:"source_reference"`
	Confidence      float64 `json:"confidence"`
}

// ---- Conversion + validation ----

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// toSuggestions converts and validates the decoded clause tool args into typed
// suggestions, dropping rows missing required fields and clamping numeric
// ranges. It returns the mean per-clause confidence as the overall confidence.
func (a clauseToolArgs) toSuggestions(now time.Time) (*ClauseSuggestions, float64) {
	sug := &ClauseSuggestions{}
	confSum := 0.0
	confCount := 0
	for _, c := range a.Clauses {
		title := strings.TrimSpace(c.Title)
		span := strings.TrimSpace(c.TextSpan)
		if title == "" && span == "" {
			continue // drop rows missing required content
		}
		clauseType, _ := model.ParseClauseType(strings.TrimSpace(c.ClauseType))
		level := model.ParseRiskLevel(c.RiskLevel)
		conf := clamp(c.Confidence, 0, 1)
		confSum += conf
		confCount++
		sug.Clauses = append(sug.Clauses, model.ExtractedClause{
			ClauseType:           clauseType,
			PrimaryType:          clauseType,
			MatchedTypes:         []model.ClauseType{clauseType},
			Title:                title,
			Content:              span,
			SectionReference:     strings.TrimSpace(c.SectionReference),
			RiskLevel:            level,
			RiskScore:            clamp(c.RiskScore, 0, 100),
			RiskKeywords:         normalizeStrings(c.RiskKeywords),
			AnalysisSummary:      strings.TrimSpace(c.Rationale),
			Recommendations:      normalizeStrings(c.Recommendations),
			ComplianceFlags:      []string{},
			ExtractionConfidence: conf,
		})
	}
	for _, p := range a.Parties {
		name := strings.TrimSpace(p.Name)
		if name == "" {
			continue
		}
		sug.Parties = append(sug.Parties, model.PartyExtraction{
			Name:   name,
			Role:   normalizePartyRole(p.Role),
			Source: defaultSource(p.Source, "llm"),
		})
	}
	for _, d := range a.Dates {
		label := strings.TrimSpace(d.Label)
		if label == "" {
			continue
		}
		var value *time.Time
		if parsed, ok := parseDate(d.Value); ok {
			value = &parsed
		}
		sug.Dates = append(sug.Dates, model.ExtractedDate{
			Label:  label,
			Value:  value,
			Source: defaultSource(d.Source, "llm"),
		})
	}
	for _, m := range a.Amounts {
		label := strings.TrimSpace(m.Label)
		if label == "" {
			continue
		}
		sug.Amounts = append(sug.Amounts, model.ExtractedAmount{
			Label:    label,
			Currency: normalizeCurrency(m.Currency),
			Value:    m.Value,
			Source:   defaultSource(m.Source, "llm"),
		})
	}
	for _, f := range a.ComplianceFlags {
		code := strings.TrimSpace(f.Code)
		if code == "" {
			continue
		}
		ref := strings.TrimSpace(f.SectionReference)
		var refPtr *string
		if ref != "" {
			refPtr = &ref
		}
		sug.ComplianceFlags = append(sug.ComplianceFlags, model.ComplianceFlag{
			Code:            code,
			Title:           defaultSource(f.Title, code),
			Description:     strings.TrimSpace(f.Description),
			Severity:        model.ParseRiskLevel(f.Severity),
			ClauseReference: refPtr,
		})
	}
	for _, k := range a.KeyFindings {
		title := strings.TrimSpace(k.Title)
		if title == "" {
			continue
		}
		var refPtr *string
		if ref := strings.TrimSpace(k.ClauseReference); ref != "" {
			refPtr = &ref
		}
		var ctPtr *model.ClauseType
		if rawCT := strings.TrimSpace(k.ClauseType); rawCT != "" {
			ct, _ := model.ParseClauseType(rawCT)
			ctPtr = &ct
		}
		sug.KeyFindings = append(sug.KeyFindings, model.RiskFinding{
			Title:           title,
			Description:     strings.TrimSpace(k.Description),
			Severity:        model.ParseRiskLevel(k.Severity),
			ClauseReference: refPtr,
			Recommendation:  strings.TrimSpace(k.Recommendation),
			ClauseType:      ctPtr,
		})
	}

	conf := 0.0
	if confCount > 0 {
		conf = confSum / float64(confCount)
	}
	return sug, conf
}

// toItems converts and validates obligation tool args into extraction items,
// dropping rows missing title or due_date and clamping confidence. It returns
// the mean confidence.
func (a obligationToolArgs) toItems() ([]dto.ObligationExtractionItem, float64) {
	items := make([]dto.ObligationExtractionItem, 0, len(a.Obligations))
	confSum := 0.0
	confCount := 0
	for _, o := range a.Obligations {
		title := strings.TrimSpace(o.Title)
		if title == "" {
			continue // required
		}
		due, ok := parseDate(o.DueDate)
		if !ok {
			continue // required
		}
		conf := clamp(o.Confidence, 0, 1)
		confSum += conf
		confCount++
		obType := normalizeObligationType(o.ObligationType)
		priority := normalizeLegalPriority(o.Priority)
		dueCopy := due
		items = append(items, dto.ObligationExtractionItem{
			Title:           title,
			Description:     strings.TrimSpace(o.Description),
			Type:            obType,
			Priority:        priority,
			DueDate:         &dueCopy,
			Source:          "llm",
			SourceReference: strings.TrimSpace(o.SourceReference),
			Tags:            []string{},
			Metadata: map[string]any{
				"extraction": map[string]any{
					"deterministic":  false,
					"llm_confidence": conf,
				},
			},
		})
	}
	conf := 0.0
	if confCount > 0 {
		conf = confSum / float64(confCount)
	}
	return items, conf
}

func normalizeStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

func defaultSource(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func normalizePartyRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "party_a":
		return "party_a"
	case "party_b":
		return "party_b"
	default:
		return "other"
	}
}

func normalizeCurrency(currency string) string {
	currency = strings.ToUpper(strings.TrimSpace(currency))
	switch currency {
	case "SAR", "USD", "EUR", "GBP", "AED":
		return currency
	default:
		return "other"
	}
}

func normalizeObligationType(raw string) model.ObligationType {
	candidate := model.ObligationType(strings.ToLower(strings.TrimSpace(raw)))
	switch candidate {
	case model.ObligationTypeContractual,
		model.ObligationTypeRenewal,
		model.ObligationTypeNotice,
		model.ObligationTypePayment,
		model.ObligationTypeDelivery,
		model.ObligationTypeReporting,
		model.ObligationTypeCompliance,
		model.ObligationTypeCovenant,
		model.ObligationTypeConditionPrecedent,
		model.ObligationTypeRegulatory,
		model.ObligationTypeOther:
		return candidate
	default:
		return model.ObligationTypeContractual
	}
}

func normalizeLegalPriority(raw string) model.LegalPriority {
	candidate := model.LegalPriority(strings.ToLower(strings.TrimSpace(raw)))
	switch candidate {
	case model.LegalPriorityCritical, model.LegalPriorityHigh, model.LegalPriorityMedium, model.LegalPriorityLow:
		return candidate
	default:
		return model.LegalPriorityMedium
	}
}

func parseDate(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{"2006-01-02", time.RFC3339} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return time.Date(parsed.UTC().Year(), parsed.UTC().Month(), parsed.UTC().Day(), 0, 0, 0, 0, time.UTC), true
		}
	}
	return time.Time{}, false
}
